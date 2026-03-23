// Configuração da API
const API_URL = 'http://localhost:3000/api';

/** Mesma lógica do dashboard: "hoje" em YYYY-MM-DD no fuso local (evita UTC com toISOString). */
function getLocalDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

let currentRoutine = null;

/** Estado em memória do cronómetro por tarefa (categoria Estudos) */
const studyRuntimeByTaskId = {};

function isEstudosRoutine(routine) {
    if (!routine || !routine.category) return false;
    const id = routine.category.id;
    return id === 'estudos' || id === 'estudo';
}

function ensureStudyTime(task) {
    if (!task.studyTime || typeof task.studyTime !== 'object') {
        task.studyTime = { totalSeconds: 0, sessions: [] };
        return;
    }
    if (typeof task.studyTime.totalSeconds !== 'number' || isNaN(task.studyTime.totalSeconds)) {
        task.studyTime.totalSeconds = 0;
    }
    if (!Array.isArray(task.studyTime.sessions)) {
        task.studyTime.sessions = [];
    }
}

function normalizeEstudosTasks(routine) {
    if (!routine || !routine.tasks || !isEstudosRoutine(routine)) return;
    routine.tasks.forEach(ensureStudyTime);
}

function studyDraftKey(routineId, taskId) {
    return 'ecStudyDraft_' + routineId + '_' + taskId;
}

function getStudyRuntime(taskId) {
    if (!studyRuntimeByTaskId[taskId]) {
        studyRuntimeByTaskId[taskId] = {
            accumulatedMs: 0,
            startedAt: null,
            intervalId: null
        };
    }
    return studyRuntimeByTaskId[taskId];
}

function disposeStudyIntervals() {
    Object.keys(studyRuntimeByTaskId).forEach(function (id) {
        const r = studyRuntimeByTaskId[id];
        if (r.intervalId) {
            clearInterval(r.intervalId);
            r.intervalId = null;
        }
        if (r.startedAt) {
            r.accumulatedMs += Date.now() - r.startedAt;
            r.startedAt = null;
        }
    });
}

function pruneStudyRuntime(taskIds) {
    const set = new Set(taskIds);
    Object.keys(studyRuntimeByTaskId).forEach(function (id) {
        if (!set.has(id)) {
            delete studyRuntimeByTaskId[id];
        }
    });
}

function currentDraftMs(taskId) {
    const r = getStudyRuntime(taskId);
    let ms = r.accumulatedMs;
    if (r.startedAt) {
        ms += Date.now() - r.startedAt;
    }
    return ms;
}

function formatClockFromMs(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = function (n) { return String(n).padStart(2, '0'); };
    if (h > 0) {
        return h + ':' + pad(m) + ':' + pad(s);
    }
    return pad(m) + ':' + pad(s);
}

function formatStudyTotalLabel(totalSeconds) {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const r = sec % 60;
    if (h > 0) {
        return h + ' h ' + m + ' min';
    }
    if (m > 0) {
        return m + ' min ' + r + ' s';
    }
    return r + ' s';
}

function formatLastSessionEnded(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '—';
    }
}

function studyDisplayId(taskId) {
    return 'study-display-' + String(taskId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function updateStudyDisplay(taskId) {
    const el = document.getElementById(studyDisplayId(taskId));
    if (el) {
        el.textContent = formatClockFromMs(currentDraftMs(taskId));
    }
    const toggleBtn = document.querySelector('.task-study-btn-toggle[data-task-id="' + taskId + '"]');
    if (toggleBtn) {
        const r = getStudyRuntime(taskId);
        toggleBtn.textContent = r.startedAt ? 'Pausar' : 'Iniciar';
    }
    const mainClock = document.getElementById('routineStudyClockDisplay');
    const studySelect = document.getElementById('routineStudyTaskSelect');
    const selected = studySelect && studySelect.value;
    if (mainClock && selected != null && String(selected) === String(taskId)) {
        mainClock.textContent = formatClockFromMs(currentDraftMs(taskId));
    }
    const mainToggle = document.getElementById('routineStudyMainToggle');
    if (mainToggle && selected != null && String(selected) === String(taskId)) {
        const r2 = getStudyRuntime(taskId);
        mainToggle.textContent = r2.startedAt ? 'Pausar' : 'Iniciar';
    }
}

function studySelectedStorageKey(routineId) {
    return 'ecStudySelectedTask_' + routineId;
}

function syncTaskCheckboxInDom(taskId, completed) {
    const rows = document.querySelectorAll('.task-item[data-task-id]');
    let row = null;
    rows.forEach(function (r) {
        if (String(r.getAttribute('data-task-id')) === String(taskId)) {
            row = r;
        }
    });
    if (!row) return;
    row.classList.toggle('completed', completed);
    const cb = row.querySelector('.task-checkbox');
    if (cb) {
        cb.classList.toggle('checked', completed);
        cb.setAttribute('aria-checked', completed ? 'true' : 'false');
    }
}

function syncProgressBarInDom() {
    const p = calculateProgress(currentRoutine);
    const pctEl = document.getElementById('progressPercent');
    const fill = document.getElementById('progressFill');
    if (pctEl) pctEl.textContent = p + '%';
    if (fill) fill.style.width = p + '%';
}

/** Marca tarefa como concluída hoje ao iniciar estudo (sem renderRoutine completo). */
async function markTaskCompleteOnStudyStart(taskId) {
    const task = currentRoutine.tasks.find(function (t) { return String(t.id) === String(taskId); });
    if (!task || task.completed) return;
    const today = getLocalDateStr(new Date());
    if (!task.completedDates) task.completedDates = [];
    task.completed = true;
    if (!task.completedDates.includes(today)) {
        task.completedDates.push(today);
        task.completedDates.sort();
    }
    await saveRoutine();
    await checkAndMarkCheckIn();
    syncTaskCheckboxInDom(taskId, true);
    syncProgressBarInDom();
}

var STUDY_CHART_MAX_SESSIONS = 12;

function formatSessionDurationLabel(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    if (s >= 3600) {
        return (s / 3600).toFixed(1).replace('.', ',') + ' h';
    }
    if (s >= 60) {
        return Math.round(s / 60) + ' min';
    }
    return s + ' s';
}

/** Rótulo legível em horas e minutos (ex.: "1 h 20 min", "45 min"). */
function formatStudyHoursMinutesTotal(seconds) {
    var s = Math.max(0, Math.floor(seconds || 0));
    if (s === 0) return '0 min';
    if (s < 60) return s + ' s';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var parts = [];
    if (h > 0) parts.push(h + ' h');
    if (m > 0) parts.push(m + ' min');
    if (parts.length === 0) parts.push('0 min');
    return parts.join(' ');
}

/** Rótulos do eixo horizontal (tempo de estudo). */
function formatStudyAxisSeconds(seconds) {
    var s = Math.max(0, Math.floor(seconds || 0));
    if (s >= 3600) {
        var h = s / 3600;
        return (Math.round(h * 10) / 10).toString().replace('.', ',') + ' h';
    }
    if (s >= 60) return Math.round(s / 60) + ' min';
    return s + ' s';
}

function renderStudyChart(task) {
    var container = document.getElementById('routineStudyChart');
    if (!container) return;
    if (!task) {
        container.innerHTML = '<p class="routine-study-chart-empty">Adicione uma tarefa para registar e visualizar sessões de estudo.</p>';
        return;
    }
    if (!task.studyTime || !Array.isArray(task.studyTime.sessions) || task.studyTime.sessions.length === 0) {
        container.innerHTML = '<p class="routine-study-chart-empty">Ainda não há sessões guardadas para esta tarefa. Use <strong>Guardar sessão</strong> após estudar.</p>';
        return;
    }
    var sorted = task.studyTime.sessions.slice().sort(function (a, b) {
        return new Date(a.endedAt) - new Date(b.endedAt);
    });
    var sessions = sorted.slice(-STUDY_CHART_MAX_SESSIONS).reverse();
    var totalSec = sessions.reduce(function (acc, s) {
        return acc + (s.durationSeconds || 0);
    }, 0);
    var durArr = sessions.map(function (s) { return s.durationSeconds || 0; });
    var maxSec = Math.max.apply(null, durArr.concat([1]));
    var tickCount = 5;
    var tickHtml = '';
    for (var ti = 0; ti < tickCount; ti++) {
        var v = tickCount <= 1 ? 0 : Math.round((maxSec * ti) / (tickCount - 1));
        tickHtml += '<span class="routine-study-chart-x-tick">' + escapeHtml(formatStudyAxisSeconds(v)) + '</span>';
    }
    var summaryHtml =
        '<div class="routine-study-chart-summary" role="status">' +
        '<span class="routine-study-chart-summary-label">Total nas últimas ' + sessions.length + ' sessão(ões):</span> ' +
        '<strong class="routine-study-chart-summary-value">' + escapeHtml(formatStudyHoursMinutesTotal(totalSec)) + '</strong>' +
        '</div>';
    var xAxisHtml =
        '<div class="routine-study-chart-x-axis" aria-hidden="true">' +
        '<span class="routine-study-chart-axis-corner">Data</span>' +
        '<div class="routine-study-chart-x-ticks">' + tickHtml + '</div>' +
        '</div>' +
        '<div class="routine-study-chart-x-axis-note" aria-hidden="true">' +
        '<span class="routine-study-chart-axis-note-spacer"></span>' +
        '<span class="routine-study-chart-x-axis-label">Tempo de estudo →</span>' +
        '</div>';
    var rowsHtml = sessions.map(function (s) {
        var sec = s.durationSeconds || 0;
        var pct = Math.round((sec / maxSec) * 1000) / 10;
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;
        var d = new Date(s.endedAt);
        var dateMain = '—';
        var dateTime = '';
        if (!isNaN(d.getTime())) {
            dateMain = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
            dateTime = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }
        var durLabel = formatSessionDurationLabel(sec);
        return '<div class="routine-study-chart-h-row" role="listitem">' +
            '<div class="routine-study-chart-date-col">' +
            '<span class="routine-study-chart-date-main">' + escapeHtml(dateMain) + '</span>' +
            (dateTime ? '<span class="routine-study-chart-date-time">' + escapeHtml(dateTime) + '</span>' : '') +
            '</div>' +
            '<div class="routine-study-chart-bar-col">' +
            '<div class="routine-study-chart-bar-track routine-study-chart-bar-track--grid" role="presentation">' +
            '<div class="routine-study-chart-bar-fill" style="width:' + pct + '%"></div>' +
            '</div>' +
            '<span class="routine-study-chart-bar-duration" title="Duração da sessão">' + escapeHtml(durLabel) + '</span>' +
            '</div></div>';
    }).join('');
    container.innerHTML =
        summaryHtml +
        '<div class="routine-study-chart-plot" role="list" aria-label="Barras horizontais: data à esquerda, tempo à direita">' +
        xAxisHtml +
        rowsHtml +
        '</div>';
}

function renderStudySection() {
    var section = document.getElementById('routineStudySection');
    if (!section || !currentRoutine) return;
    var tasks = currentRoutine.tasks || [];
    if (!isEstudosRoutine(currentRoutine)) {
        section.hidden = true;
        section.innerHTML = '';
        return;
    }
    section.hidden = false;
    var hasTasks = tasks.length > 0;
    var rid = currentRoutine.id;
    var saved = null;
    try {
        saved = sessionStorage.getItem(studySelectedStorageKey(rid));
    } catch (e) { /* ignore */ }
    var selectedId = hasTasks && saved && tasks.some(function (t) { return String(t.id) === String(saved); })
        ? String(saved)
        : (hasTasks ? String(tasks[0].id) : '');

    var taskPickHtml = hasTasks
        ? '<div class="routine-study-task-pick">' +
        '<label for="routineStudyTaskSelect" class="routine-study-label">Tarefa ativa</label>' +
        '<select id="routineStudyTaskSelect" class="routine-study-select" aria-label="Escolher tarefa para estudar">' +
        tasks.map(function (t) {
            return '<option value="' + escapeHtml(String(t.id)) + '">' + escapeHtml(t.text || 'Tarefa') + '</option>';
        }).join('') +
        '</select></div>'
        : '<div class="routine-study-task-pick routine-study-task-pick--empty">' +
        '<p class="routine-study-no-tasks-msg" role="status">Nenhuma tarefa ainda. Adicione uma tarefa abaixo para associar o tempo de estudo ao cronómetro.</p>' +
        '</div>';

    var btnAttrs = hasTasks ? '' : ' disabled aria-disabled="true"';

    section.innerHTML =
        '<h3 class="routine-study-heading">Estudo</h3>' +
        taskPickHtml +
        '<div class="routine-study-clock-wrap">' +
        '<i data-lucide="timer" class="routine-study-clock-icon" aria-hidden="true"></i>' +
        '<div class="routine-study-clock-display" id="routineStudyClockDisplay">00:00</div>' +
        '<div class="routine-study-clock-actions">' +
        '<button type="button" id="routineStudyMainToggle" class="task-study-btn routine-study-main-btn"' + btnAttrs + ' aria-label="Iniciar ou pausar cronómetro de estudo">Iniciar</button>' +
        '<button type="button" id="routineStudyMainSave" class="task-study-btn routine-study-main-btn"' + btnAttrs + ' aria-label="Guardar tempo desta sessão de estudo">Guardar sessão</button>' +
        '</div></div>' +
        '<div class="routine-study-chart-wrap">' +
        '<h4 class="routine-study-chart-title">Histórico de sessões</h4>' +
        '<p class="routine-study-chart-hint">Data e hora à esquerda; comprimento da barra representa a duração da sessão relativamente ao intervalo exibido.</p>' +
        '<div id="routineStudyChart" class="routine-study-chart" role="region" aria-label="Gráfico das últimas sessões de estudo"></div></div>';

    if (hasTasks) {
        var sel = document.getElementById('routineStudyTaskSelect');
        sel.value = selectedId;

        function taskBySelectedId() {
            return currentRoutine.tasks.find(function (t) { return String(t.id) === String(sel.value); });
        }

        sel.addEventListener('change', function () {
            disposeStudyIntervals();
            try {
                sessionStorage.setItem(studySelectedStorageKey(rid), sel.value);
            } catch (e) { /* ignore */ }
            restoreStudyDraftFromStorage(sel.value);
            updateStudyDisplay(sel.value);
            renderStudyChart(taskBySelectedId());
        });

        document.getElementById('routineStudyMainToggle').addEventListener('click', function () {
            toggleStudyTimer(sel.value).catch(function (err) { console.error(err); });
        });
        document.getElementById('routineStudyMainSave').addEventListener('click', function () {
            saveStudySessionForTask(sel.value);
        });

        restoreStudyDraftFromStorage(selectedId);
        updateStudyDisplay(selectedId);
        renderStudyChart(taskBySelectedId());
    } else {
        var clockEl = document.getElementById('routineStudyClockDisplay');
        if (clockEl) clockEl.textContent = '00:00';
        renderStudyChart(null);
    }

    var lucideLib = typeof lucide !== 'undefined' ? lucide : (typeof Lucide !== 'undefined' ? Lucide : null);
    if (lucideLib && lucideLib.createIcons) {
        lucideLib.createIcons();
    }
}

function startStudyTick(taskId) {
    const r = getStudyRuntime(taskId);
    if (r.intervalId) {
        clearInterval(r.intervalId);
    }
    r.intervalId = setInterval(function () {
        updateStudyDisplay(taskId);
    }, 1000);
}

function stopStudyTick(taskId) {
    const r = getStudyRuntime(taskId);
    if (r.intervalId) {
        clearInterval(r.intervalId);
        r.intervalId = null;
    }
}

function persistStudyDraftsToStorage() {
    if (!currentRoutine || !isEstudosRoutine(currentRoutine) || !currentRoutine.tasks) return;
    const rid = currentRoutine.id;
    currentRoutine.tasks.forEach(function (task) {
        const ms = currentDraftMs(task.id);
        if (ms >= 1000) {
            try {
                sessionStorage.setItem(studyDraftKey(rid, task.id), JSON.stringify({ accumulatedMs: ms }));
            } catch (e) { /* ignore */ }
        }
    });
}

function restoreStudyDraftFromStorage(taskId) {
    if (!currentRoutine) return;
    const key = studyDraftKey(currentRoutine.id, taskId);
    let raw;
    try {
        raw = sessionStorage.getItem(key);
    } catch (e) {
        return;
    }
    if (!raw) return;
    try {
        const data = JSON.parse(raw);
        if (data && typeof data.accumulatedMs === 'number' && data.accumulatedMs > 0) {
            const r = getStudyRuntime(taskId);
            r.accumulatedMs = data.accumulatedMs;
            r.startedAt = null;
        }
    } catch (e) { /* ignore */ }
}

function clearStudyDraftStorage(taskId) {
    if (!currentRoutine) return;
    try {
        sessionStorage.removeItem(studyDraftKey(currentRoutine.id, taskId));
    } catch (e) { /* ignore */ }
}

// Carregar dados ao iniciar
document.addEventListener('DOMContentLoaded', async () => {
    // Carregar nome do usuário
    const usernameElement = document.getElementById('username');
    const userName = localStorage.getItem('userName') || 'DESENVOLVEDOR';
    usernameElement.textContent = userName.toUpperCase();

    // Obter ID da rotina da URL
    const urlParams = new URLSearchParams(window.location.search);
    const routineId = urlParams.get('id');

    if (!routineId) {
        alert('Rotina não encontrada');
        window.location.href = 'dashboard.html';
        return;
    }

    // Carregar rotina
    await loadRoutine(routineId);

    // Configurar event listeners
    setupEventListeners();

    window.addEventListener('beforeunload', function () {
        persistStudyDraftsToStorage();
    });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            persistStudyDraftsToStorage();
        }
    });
});

// Configurar event listeners
function setupEventListeners() {
    // Botão de adicionar tarefa
    const addTaskBtn = document.getElementById('addTaskBtn');
    addTaskBtn.addEventListener('click', showAddTaskInput);

    // Botão de editar
    const editBtn = document.getElementById('editBtn');
    editBtn.addEventListener('click', () => {
        window.location.href = `create.html?edit=${currentRoutine.id}`;
    });

    // Botão de deletar (ícone lixo Uiverse)
    const delEl = document.getElementById('deleteBtn');
    if (delEl && typeof trashBinButtonHTML === 'function') {
        delEl.outerHTML = trashBinButtonHTML({
            id: 'deleteBtn',
            className: 'action-btn delete-btn uiverse-trash-btn--routine-header',
            labelText: 'Excluir',
            title: 'Excluir rotina',
            ariaLabel: 'Excluir rotina'
        });
    }
    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', deleteRoutine);

    // Sem horário fixo: V = tarefa completa, × = tarefa incompleta (hoje)
    const btnComplete = document.getElementById('btnTaskCompleteDetail');
    const btnIncomplete = document.getElementById('btnTaskIncompleteDetail');
    if (btnComplete) btnComplete.addEventListener('click', markRoutineCompleteToday);
    if (btnIncomplete) btnIncomplete.addEventListener('click', markRoutineIncompleteToday);
}

// Marcar rotina como completa hoje (botão V na página de detalhe)
async function markRoutineCompleteToday() {
    if (!currentRoutine) return;
    const today = getLocalDateStr(new Date());
    if (currentRoutine.tasks && currentRoutine.tasks.length > 0) {
        currentRoutine.tasks.forEach(task => {
            if (!task.completedDates) task.completedDates = [];
            if (!task.completedDates.includes(today)) {
                task.completedDates.push(today);
                task.completedDates.sort();
            }
        });
        currentRoutine.tasks.forEach(t => { t.completed = true; });
    }
    if (!currentRoutine.checkIns) currentRoutine.checkIns = [];
    if (!currentRoutine.checkIns.includes(today)) {
        currentRoutine.checkIns.push(today);
        currentRoutine.checkIns.sort();
    }
    await saveRoutine();
    renderRoutine();
    showSaveSuccessMessage();
    setRoutineCompleteAnsweredToday(currentRoutine.id);
    hideCompleteQuestionBlock();
}

// Marcar rotina como incompleta hoje (botão × na página de detalhe)
async function markRoutineIncompleteToday() {
    if (!currentRoutine) return;
    const today = getLocalDateStr(new Date());
    let needsSave = false;
    if (currentRoutine.tasks) {
        currentRoutine.tasks.forEach(task => {
            if (task.completedDates && task.completedDates.includes(today)) {
                task.completedDates = task.completedDates.filter(d => d !== today);
                task.completed = false;
                needsSave = true;
            }
        });
    }
    if (currentRoutine.checkIns && currentRoutine.checkIns.includes(today)) {
        currentRoutine.checkIns = currentRoutine.checkIns.filter(d => d !== today);
        needsSave = true;
    }
    if (needsSave) await saveRoutine();
    renderRoutine();
    showSaveSuccessMessage();
    setRoutineCompleteAnsweredToday(currentRoutine.id);
    hideCompleteQuestionBlock();
}

// Pergunta "TAREFA COMPLETA?" aparece só uma vez por dia (por rotina)
function getRoutineCompleteAnsweredKey(routineId) {
    const today = getLocalDateStr(new Date());
    return `routineCompleteAnswered_${routineId}_${today}`;
}

function hasRoutineCompleteAnsweredToday(routineId) {
    return !!localStorage.getItem(getRoutineCompleteAnsweredKey(routineId));
}

function setRoutineCompleteAnsweredToday(routineId) {
    localStorage.setItem(getRoutineCompleteAnsweredKey(routineId), '1');
}

// Esconder a pergunta "TAREFA COMPLETA?" após o usuário responder (✓ ou ✗), com transição
function hideCompleteQuestionBlock() {
    const block = document.getElementById('routineCompleteBlock');
    if (!block) return;
    block.classList.add('routine-complete-block--hiding');
    setTimeout(() => {
        block.style.display = 'none';
        block.classList.remove('routine-complete-block--hiding');
    }, 350);
}

// Mensagem de sucesso ao salvar (toast estilizado); some ao clicar
function showSaveSuccessMessage() {
    const toast = document.getElementById('saveToast');
    if (!toast) return;
    toast.classList.remove('save-toast--visible', 'save-toast--hiding');
    clearTimeout(toast._hideTimeout);
    requestAnimationFrame(() => {
        toast.classList.add('save-toast--visible');
    });
    toast._hideTimeout = setTimeout(hideSaveSuccessMessage, 2500);
    toast.onclick = hideSaveSuccessMessage;
}

function hideSaveSuccessMessage() {
    const toast = document.getElementById('saveToast');
    if (!toast) return;
    clearTimeout(toast._hideTimeout);
    toast.onclick = null;
    toast.classList.add('save-toast--hiding');
    setTimeout(() => {
        toast.classList.remove('save-toast--visible', 'save-toast--hiding');
    }, 300);
}

// Carregar rotina
async function loadRoutine(routineId) {
    const token = localStorage.getItem('token');
    let routine = null;

    if (token) {
        try {
            const routines = await apiRequest('/routines');
            routine = routines.find(r => r.id === routineId);
        } catch (error) {
            console.log('Servidor não disponível, carregando localmente');
        }
    }

    // Modo offline: carregar do localStorage
    if (!routine) {
        const routines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
        routine = routines.find(r => r.id === routineId);
    }

    if (!routine) {
        alert('Rotina não encontrada');
        window.location.href = 'dashboard.html';
        return;
    }

    currentRoutine = routine;
    normalizeEstudosTasks(currentRoutine);
    renderRoutine();
}

// Compatibilidade: emoji antigo -> fallback Lucide
function getLucideIconName(icon) {
    if (!icon || typeof icon !== 'string') return 'clipboard-list';
    const trimmed = icon.trim();
    if (!trimmed) return 'clipboard-list';
    if (trimmed.length <= 2 || /[^\w-]/.test(trimmed)) return 'clipboard-list';
    return trimmed;
}

// Renderizar rotina
function renderRoutine() {
    if (!currentRoutine) return;

    // Título e ícone da categoria (Lucide)
    document.getElementById('routineTitle').textContent = currentRoutine.title;
    const iconEl = document.getElementById('routineIcon');
    if (iconEl) {
        const iconName = getLucideIconName(currentRoutine.category?.icon);
        iconEl.innerHTML = '<i data-lucide="' + escapeHtml(iconName) + '"></i>';
        const lucideLib = typeof lucide !== 'undefined' ? lucide : (typeof Lucide !== 'undefined' ? Lucide : null);
        if (lucideLib && lucideLib.createIcons) {
            lucideLib.createIcons();
        }
    }

    // Descrição
    const descriptionEl = document.getElementById('routineDescription');
    if (currentRoutine.description) {
        descriptionEl.textContent = currentRoutine.description;
        descriptionEl.style.display = 'block';
    } else {
        descriptionEl.style.display = 'none';
    }

    // Data e hora
    const dateEl = document.getElementById('routineDate');
    const timeEl = document.getElementById('routineTime');
    
    if (currentRoutine.schedule?.date) {
        const date = new Date(currentRoutine.schedule.date);
        dateEl.textContent = date.toLocaleDateString('pt-BR');
    } else {
        dateEl.textContent = 'Não definida';
    }

    if (currentRoutine.schedule?.time) {
        timeEl.textContent = currentRoutine.schedule.time;
    } else {
        timeEl.textContent = 'Não definido';
    }

    // Tipo de planejamento e repetição (semanal/mensal)
    const planType = currentRoutine.planType || 'daily';
    const planLabels = { daily: 'Dia', weekly: 'Semana', monthly: 'Mensal' };
    let planText = planLabels[planType] || 'Dia';
    const s = currentRoutine.schedule || {};
    if (s.weekDays && s.weekDays.length) {
        const dayNames = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };
        planText += ' · ' + s.weekDays.sort((a, b) => a - b).map(d => dayNames[d]).join(', ');
    }
    if (planType === 'monthly' && s.monthlyType) {
        if (s.monthlyType === 'dayOfMonth' && s.dayOfMonth) {
            planText += ' · Todo dia ' + s.dayOfMonth;
        }
        if (s.monthlyType === 'weekOfMonth' && (s.weekOfMonth != null || s.dayOfWeek != null)) {
            const ord = s.weekOfMonth === 'last' ? 'última' : (s.weekOfMonth + 'ª');
            const dayNames = { 0: 'domingo', 1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado' };
            planText += ' · Toda ' + ord + ' ' + (dayNames[s.dayOfWeek] || '');
        }
    }
    const planTypeEl = document.getElementById('routinePlanType');
    if (planTypeEl) planTypeEl.textContent = planText;

    // Sem horário fixo: mostrar pergunta TAREFA COMPLETA? só em dias selecionados e só uma vez no dia (por rotina)
    const noFixedTime = !currentRoutine.schedule || !currentRoutine.schedule.time;
    const weekDays = currentRoutine.schedule && currentRoutine.schedule.weekDays;
    const todayIsSelected = !weekDays || !weekDays.length || weekDays.indexOf(new Date().getDay()) !== -1;
    const alreadyAnsweredToday = hasRoutineCompleteAnsweredToday(currentRoutine.id);
    const completeBlock = document.getElementById('routineCompleteBlock');
    if (completeBlock) completeBlock.style.display = (noFixedTime && todayIsSelected && !alreadyAnsweredToday) ? 'block' : 'none';

    // Objetivos e motivos (mostrar só se preenchidos)
    const objectives = (currentRoutine.objectives || '').trim();
    const reasons = (currentRoutine.reasons || '').trim();
    const objectivesSection = document.getElementById('routineObjectivesSection');
    const reasonsSection = document.getElementById('routineReasonsSection');
    const objectivesEl = document.getElementById('routineObjectives');
    const reasonsEl = document.getElementById('routineReasons');
    if (objectivesSection && objectivesEl) {
        objectivesEl.textContent = objectives || '';
        objectivesSection.style.display = objectives ? 'block' : 'none';
    }
    if (reasonsSection && reasonsEl) {
        reasonsEl.textContent = reasons || '';
        reasonsSection.style.display = reasons ? 'block' : 'none';
    }

    // Progresso
    const progress = calculateProgress(currentRoutine);
    document.getElementById('progressPercent').textContent = `${progress}%`;
    document.getElementById('progressFill').style.width = `${progress}%`;
    const progressSectionEl = document.querySelector('.progress-section');
    if (progressSectionEl) {
        progressSectionEl.classList.toggle('progress-section--complete', progress >= 100);
    }

    // Tarefas (cronómetro de estudo é renderizado depois em renderStudySection)
    renderTasks();
    renderStudySection();
}

// Renderizar tarefas
function renderTasks() {
    const taskList = document.getElementById('taskList');

    disposeStudyIntervals();
    if (currentRoutine.tasks && currentRoutine.tasks.length) {
        pruneStudyRuntime(currentRoutine.tasks.map(function (t) { return t.id; }));
    } else {
        pruneStudyRuntime([]);
    }

    if (!currentRoutine.tasks || currentRoutine.tasks.length === 0) {
        taskList.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Nenhuma tarefa adicionada ainda</p>';
        return;
    }

    taskList.innerHTML = currentRoutine.tasks.map(task => {
        if (isEstudosRoutine(currentRoutine)) {
            ensureStudyTime(task);
        }
        const dates = task.completedDates || [];
        const datesFormatted = dates.map(d => {
            const date = new Date(d + 'T12:00:00');
            return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
        }).slice(-5).reverse();
        const datesHtml = datesFormatted.length > 0
            ? `<div class="task-completed-dates" title="Datas de conclusão: ${datesFormatted.join(', ')}">📅 ${datesFormatted.join(', ')}</div>`
            : '';

        return `
        <div class="task-item ${task.completed ? 'completed' : ''}" data-task-id="${escapeHtml(String(task.id))}">
            <div class="task-item-row">
                <div class="task-checkbox ${task.completed ? 'checked' : ''}" data-task-id="${escapeHtml(String(task.id))}" role="checkbox" aria-checked="${task.completed ? 'true' : 'false'}"></div>
                <div class="task-content">
                    <span class="task-text">${escapeHtml(task.text)}</span>
                    ${datesHtml}
                </div>
                ${typeof trashBinButtonHTML === 'function' ? trashBinButtonHTML({ className: 'task-delete delete', modifier: 'uiverse-trash-btn--task', dataAttrs: { 'data-task-id': String(task.id) }, ariaLabel: 'Excluir tarefa', title: 'Excluir tarefa' }) : `<button type="button" class="task-delete" data-task-id="${escapeHtml(String(task.id))}" aria-label="Excluir tarefa">×</button>`}
            </div>
        </div>
        `;
    }).join('');

    const lucideLib = typeof lucide !== 'undefined' ? lucide : (typeof Lucide !== 'undefined' ? Lucide : null);
    if (lucideLib && lucideLib.createIcons) {
        lucideLib.createIcons();
    }

    document.querySelectorAll('.task-checkbox').forEach(checkbox => {
        checkbox.addEventListener('click', (e) => {
            const taskId = e.target.dataset.taskId;
            toggleTask(taskId);
        });
    });

    document.querySelectorAll('.task-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const el = e.currentTarget;
            const taskId = el && el.dataset ? el.dataset.taskId : null;
            if (taskId) deleteTask(taskId);
        });
    });
}

async function toggleStudyTimer(taskId) {
    if (!taskId || !currentRoutine || !isEstudosRoutine(currentRoutine)) return;
    const r = getStudyRuntime(taskId);
    if (r.startedAt) {
        r.accumulatedMs += Date.now() - r.startedAt;
        r.startedAt = null;
        stopStudyTick(taskId);
    } else {
        var cleanStart = r.accumulatedMs === 0;
        if (cleanStart) {
            await markTaskCompleteOnStudyStart(taskId);
        }
        r.startedAt = Date.now();
        startStudyTick(taskId);
    }
    updateStudyDisplay(taskId);
}

async function saveStudySessionForTask(taskId) {
    if (!taskId || !currentRoutine || !isEstudosRoutine(currentRoutine)) return;
    const task = currentRoutine.tasks.find(function (t) { return String(t.id) === String(taskId); });
    if (!task) return;
    ensureStudyTime(task);
    const ms = currentDraftMs(taskId);
    const seconds = Math.floor(ms / 1000);
    if (seconds < 1) {
        alert('Acumule pelo menos 1 segundo de estudo antes de guardar a sessão.');
        return;
    }
    stopStudyTick(taskId);
    const r = getStudyRuntime(taskId);
    r.accumulatedMs = 0;
    r.startedAt = null;
    task.studyTime.totalSeconds += seconds;
    task.studyTime.sessions.push({
        endedAt: new Date().toISOString(),
        durationSeconds: seconds
    });
    clearStudyDraftStorage(taskId);
    await saveRoutine();
    showSaveSuccessMessage();
    renderRoutine();
}

// Calcular progresso (% tarefas com completed; sem tarefas = 100% se hoje está em checkIns — ex.: "Tarefa completa?")
function calculateProgress(routine) {
    const today = getLocalDateStr(new Date());
    if (!routine.tasks || routine.tasks.length === 0) {
        if (routine.checkIns && routine.checkIns.includes(today)) {
            return 100;
        }
        return 0;
    }
    const completedTasks = routine.tasks.filter(t => t.completed).length;
    return Math.round((completedTasks / routine.tasks.length) * 100);
}

// Mostrar input para adicionar tarefa
function showAddTaskInput() {
    const taskList = document.getElementById('taskList');
    const inputHTML = `
        <div class="task-input-container" id="taskInputContainer">
            <input type="text" class="task-input" id="newTaskInput" placeholder="Digite a tarefa...">
            <button class="task-input-btn" id="saveTaskBtn">Salvar</button>
            <button class="task-input-btn cancel" id="cancelTaskBtn">Cancelar</button>
        </div>
    `;
    taskList.insertAdjacentHTML('beforeend', inputHTML);

    const input = document.getElementById('newTaskInput');
    input.focus();

    document.getElementById('saveTaskBtn').addEventListener('click', saveNewTask);
    document.getElementById('cancelTaskBtn').addEventListener('click', () => {
        document.getElementById('taskInputContainer').remove();
    });

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveNewTask();
        }
    });
}

// Salvar nova tarefa
async function saveNewTask() {
    const input = document.getElementById('newTaskInput');
    const text = input.value.trim();

    if (!text) {
        alert('Por favor, digite uma tarefa');
        return;
    }

    const newTask = {
        id: Date.now().toString(),
        text: text,
        completed: false,
        completedDates: [],
        createdAt: new Date().toISOString()
    };
    if (isEstudosRoutine(currentRoutine)) {
        newTask.studyTime = { totalSeconds: 0, sessions: [] };
    }

    if (!currentRoutine.tasks) {
        currentRoutine.tasks = [];
    }
    currentRoutine.tasks.push(newTask);

    await saveRoutine();
    renderRoutine();
}

// Alternar tarefa (marcar/desmarcar)
async function toggleTask(taskId) {
    const task = currentRoutine.tasks.find(t => t.id === taskId);
    if (task) {
        const today = getLocalDateStr(new Date());
        
        if (!task.completedDates) {
            task.completedDates = [];
        }
        
        task.completed = !task.completed;
        
        if (task.completed) {
            if (!task.completedDates.includes(today)) {
                task.completedDates.push(today);
                task.completedDates.sort();
            }
        } else {
            task.completedDates = task.completedDates.filter(d => d !== today);
        }
        
        await saveRoutine();
        
        // Verificar se todas as tarefas foram completadas para marcar check-in
        checkAndMarkCheckIn();
        
        renderRoutine();
    }
}

// Verificar e marcar check-in se todas as tarefas estiverem completas
async function checkAndMarkCheckIn() {
    if (!currentRoutine.tasks || currentRoutine.tasks.length === 0) {
        return;
    }
    
    const allCompleted = currentRoutine.tasks.every(t => t.completed);
    if (allCompleted) {
        const today = getLocalDateStr(new Date());
        let needsSave = false;
        
        // Garantir que todas as tarefas tenham hoje em completedDates
        currentRoutine.tasks.forEach(task => {
            if (!task.completedDates) task.completedDates = [];
            if (!task.completedDates.includes(today)) {
                task.completedDates.push(today);
                task.completedDates.sort();
                needsSave = true;
            }
        });
        
        // Manter checkIns da rotina para compatibilidade (heatmap usa task.completedDates)
        if (!currentRoutine.checkIns) {
            currentRoutine.checkIns = [];
        }
        if (!currentRoutine.checkIns.includes(today)) {
            currentRoutine.checkIns.push(today);
            currentRoutine.checkIns.sort();
            needsSave = true;
        }
        
        if (needsSave) {
            const token = localStorage.getItem('token');
            if (token) {
                try {
                    await apiRequest(`/routines/${currentRoutine.id}/checkin`, {
                        method: 'POST',
                        body: JSON.stringify({ date: today })
                    });
                } catch (error) {
                    console.log('Erro ao salvar check-in no servidor, salvando localmente');
                }
            }
            await saveRoutine();
        }
    }
}

// Deletar tarefa
async function deleteTask(taskId) {
    if (!confirm('Tem certeza que deseja excluir esta tarefa?')) {
        return;
    }

    stopStudyTick(taskId);
    delete studyRuntimeByTaskId[taskId];
    clearStudyDraftStorage(taskId);

    currentRoutine.tasks = currentRoutine.tasks.filter(t => String(t.id) !== String(taskId));
    await saveRoutine();
    renderRoutine();
}

/** Espelha a rotina atual no localStorage para outras abas/dashboard atualizarem. */
function syncCurrentRoutineToLocalRoutines() {
    try {
        let routines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
        const index = routines.findIndex(r => r.id === currentRoutine.id);
        if (index !== -1) {
            routines[index] = currentRoutine;
        } else {
            routines.push(currentRoutine);
        }
        localStorage.setItem('localRoutines', JSON.stringify(routines));
    } catch (e) {
        console.warn('syncCurrentRoutineToLocalRoutines', e);
    }
}

/** Avisa dashboard/outras abas para recarregarem rotinas (storage + BroadcastChannel). */
function notifyRoutinesUpdatedGlobally() {
    try {
        var ch = new BroadcastChannel('ec-routine-sync');
        ch.postMessage({ type: 'routines-updated' });
        ch.close();
    } catch (e) { /* ignore */ }
}

// Salvar rotina
async function saveRoutine() {
    // Recalcular progresso
    currentRoutine.progress = calculateProgress(currentRoutine);
    
    // Garantir que checkIns existe
    if (!currentRoutine.checkIns) {
        currentRoutine.checkIns = [];
    }

    const token = localStorage.getItem('token');

    if (token) {
        try {
            await apiRequest(`/routines/${currentRoutine.id}`, {
                method: 'PUT',
                body: JSON.stringify(currentRoutine)
            });
            syncCurrentRoutineToLocalRoutines();
            notifyRoutinesUpdatedGlobally();
            return;
        } catch (error) {
            console.log('Servidor não disponível, salvando localmente');
        }
    }

    // Salvar no localStorage
    let routines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
    const index = routines.findIndex(r => r.id === currentRoutine.id);
    if (index !== -1) {
        routines[index] = currentRoutine;
    } else {
        routines.push(currentRoutine);
    }
    localStorage.setItem('localRoutines', JSON.stringify(routines));
    notifyRoutinesUpdatedGlobally();
}

// Deletar rotina
async function deleteRoutine() {
    if (!confirm('Tem certeza que deseja excluir esta rotina? Todas as tarefas serão perdidas.')) {
        return;
    }

    const token = localStorage.getItem('token');

    if (token) {
        try {
            await apiRequest(`/routines/${currentRoutine.id}`, {
                method: 'DELETE'
            });
        } catch (error) {
            console.log('Servidor não disponível, removendo localmente');
        }
    }

    // Remover do localStorage
    let routines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
    routines = routines.filter(r => r.id !== currentRoutine.id);
    localStorage.setItem('localRoutines', JSON.stringify(routines));

    window.location.href = 'dashboard.html';
}

// Função para fazer requisições à API
async function apiRequest(endpoint, options = {}) {
    try {
        const token = localStorage.getItem('token');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        };

        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            throw new Error(text || 'Erro na requisição');
        }

        if (!response.ok) {
            throw new Error(data.error || 'Erro na requisição');
        }

        return data;
    } catch (error) {
        console.error('Erro na requisição:', error);
        throw error;
    }
}

// Função auxiliar para escapar HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
