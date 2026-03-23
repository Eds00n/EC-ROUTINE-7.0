// Configuração da API
const API_URL = 'http://localhost:3000/api';

// MODO DESENVOLVIMENTO: Autenticação desativada temporariamente
const DEV_MODE = true; // Altere para false para reativar autenticação

// Array para armazenar tarefas temporárias
let initialTasks = [];

// Estado do wizard (1 a 4)
let currentStep = 1;

// Categorias de rotina com ícones Lucide (kebab-case)
const ROUTINE_CATEGORIES = [
    { id: 'musculacao', name: 'Musculação', icon: 'dumbbell' },
    { id: 'alimentacao', name: 'Alimentação', icon: 'salad' },
    { id: 'suplementacao', name: 'Suplementação', icon: 'pill' },
    { id: 'estudos', name: 'Estudos', icon: 'book-open' },
    { id: 'trabalho', name: 'Trabalho', icon: 'briefcase' },
    { id: 'meditacao', name: 'Meditação', icon: 'brain' },
    { id: 'sono', name: 'Sono', icon: 'moon' },
    { id: 'cardio', name: 'Cardio', icon: 'activity' },
    { id: 'leitura', name: 'Leitura', icon: 'book-marked' },
    { id: 'organizacao', name: 'Organização', icon: 'clipboard-list' },
    { id: 'saude', name: 'Saúde', icon: 'heart' },
    { id: 'rotina_matinal', name: 'Rotina Matinal', icon: 'sunrise' },
    { id: 'rotina_noturna', name: 'Rotina Noturna', icon: 'moon' },
    { id: 'hidratacao', name: 'Hidratação', icon: 'droplets' },
    { id: 'lazer', name: 'Lazer', icon: 'gamepad-2' }
];

// Garantir que goToNextStep existe no window assim que o script carrega (para o onclick no HTML)
function goToNextStep(fromStep) {
    if (fromStep === 1) {
        const selected = document.querySelector('input[name="planType"]:checked');
        if (!selected) {
            alert('Selecione o tipo da tarefa.');
            return;
        }
    }
    if (fromStep === 2) {
        const titleEl = document.getElementById('routineTitle');
        const title = titleEl ? titleEl.value.trim() : '';
        if (!title) {
            alert('Por favor, preencha o nome da tarefa.');
            return;
        }
        const bulletSelected = document.querySelector('input[name="bulletType"]:checked');
        if (!bulletSelected) {
            alert('Selecione o nível de importância.');
            return;
        }
    }
    currentStep = fromStep + 1;
    window.__wizardStep = currentStep;
    showWizardStep(currentStep);
    updateWizardProgress(currentStep);
}
window.goToNextStep = goToNextStep;

function goToStep(step) {
    const s = parseInt(step, 10);
    if (s < 1 || s > 4) return;
    currentStep = s;
    window.__wizardStep = s;
    showWizardStep(currentStep);
    updateWizardProgress(currentStep);
}
window.goToStep = goToStep;

// Carregar dados do usuário
document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.__wizardStep === 'number') currentStep = window.__wizardStep;

    // Botão "Criar Rotina": registrar primeiro para não ser afetado por erros posteriores
    const btnCreateRoutine = document.getElementById('btnCreateRoutine');
    const wizardProgressEl = document.getElementById('wizardProgress');
    if (btnCreateRoutine) {
        btnCreateRoutine.addEventListener('click', (e) => {
            if (e && e.preventDefault) e.preventDefault();
            if (e && e.stopPropagation) e.stopPropagation();
            handleCreateRoutine(e);
        }, true);
        if (wizardProgressEl) {
            btnCreateRoutine.addEventListener('mouseenter', () => wizardProgressEl.classList.add('wizard-progress--create-hover'));
            btnCreateRoutine.addEventListener('mouseleave', () => wizardProgressEl.classList.remove('wizard-progress--create-hover'));
        }
    }

    // Delegar cliques nos botões Continuar (fase de captura)
    document.addEventListener('click', (e) => {
        const id = e.target && e.target.id;
        if (id === 'btnContinuarStep1') { e.preventDefault(); e.stopPropagation(); goToNextStep(1); return; }
        if (id === 'btnContinuarStep2') { e.preventDefault(); e.stopPropagation(); goToNextStep(2); return; }
        if (id === 'btnContinuarStep3') { e.preventDefault(); e.stopPropagation(); goToNextStep(3); return; }
    }, true);
    // Delegar cliques nos botões Voltar (fase de captura) para funcionar mesmo se algo falhar depois
    document.addEventListener('click', (e) => {
        const el = e.target && e.target.closest && e.target.closest('.btn-voltar');
        if (!el) return;
        const goto = parseInt(el.getAttribute('data-goto'), 10);
        if (goto >= 1 && goto <= 4) {
            e.preventDefault();
            e.stopPropagation();
            currentStep = goto;
            window.__wizardStep = goto;
            showWizardStep(currentStep);
            updateWizardProgress(currentStep);
        }
    }, true);

    // Também ligar diretamente nos botões (redundante mas garante)
    const btn1 = document.getElementById('btnContinuarStep1');
    const btn2 = document.getElementById('btnContinuarStep2');
    const btn3 = document.getElementById('btnContinuarStep3');
    if (btn1) btn1.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); goToNextStep(1); });
    if (btn2) btn2.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); goToNextStep(2); });
    if (btn3) btn3.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); goToNextStep(3); });

    // Garantir que tem dados de desenvolvimento
    if (!localStorage.getItem('userName')) {
        localStorage.setItem('userName', 'DESENVOLVEDOR');
        localStorage.setItem('userId', 'dev-' + Date.now());
    }
    
    const userName = localStorage.getItem('userName') || 'DESENVOLVEDOR';
    const usernameElement = document.getElementById('username');
    if (usernameElement) usernameElement.textContent = userName.toUpperCase();

    // Verificar se é edição
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    if (editId) {
        loadRoutineForEdit(editId);
    }

    // Configurar formulário (submit: nos passos 1–3 avança; no passo 4 cria a rotina)
    const createForm = document.getElementById('createForm');
    if (createForm) {
        createForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (typeof window.__wizardStep === 'number') currentStep = window.__wizardStep;
            const step4El = document.getElementById('wizardStep4');
            if (step4El && step4El.style.display !== 'none') currentStep = 4;
            if (currentStep < 4) {
                goToNextStep(currentStep);
            }
            // Passo 4: apenas o clique em "Criar Rotina" dispara a criação
        });
    }

    // Configurar adição de tarefas
    setupTaskInput();

    // Renderizar categorias
    renderCategories();
    setupCategoryListeners();

    // Wizard: mostrar apenas o passo atual
    showWizardStep(currentStep);
    updateWizardProgress(currentStep);

    // Passo 1: habilitar Continuar só ao selecionar tipo; animação ao selecionar
    setupStep1Listeners();

    // Passo 2: habilitar Continuar só com nome + nível de importância
    setupStep2Listeners();

    // Passo 3: botão Pular/Continuar e auto-resize dos textareas
    setupStep3Details();

    // Passo 4: listeners (horário, preview, mensal)
    setupStep4Listeners();

});

function setupStep1Listeners() {
    document.querySelectorAll('input[name="planType"]').forEach(radio => {
        radio.addEventListener('change', function () {
            updateStep1SubmitState();
            const label = this.closest('label.wizard-option');
            const ring = label && label.querySelector('.wizard-option-radio');
            if (ring) {
                ring.classList.remove('wizard-option-radio--selected');
                ring.offsetHeight;
                ring.classList.add('wizard-option-radio--selected');
                ring.addEventListener('animationend', function once() {
                    ring.classList.remove('wizard-option-radio--selected');
                    ring.removeEventListener('animationend', once);
                });
            }
        });
    });
}

function setupStep2Listeners() {
    const titleEl = document.getElementById('routineTitle');
    if (titleEl) titleEl.addEventListener('input', updateStep2SubmitState);
    document.querySelectorAll('input[name="bulletType"]').forEach(radio => {
        radio.addEventListener('change', updateStep2SubmitState);
    });
}

function showWizardStep(step) {
    document.querySelectorAll('.create-step').forEach(el => {
        const isVisible = el.getAttribute('data-step') === String(step);
        el.style.display = isVisible ? (step === 4 ? 'grid' : 'block') : 'none';
        if (el.id === 'wizardStep4') el.classList.toggle('wizard-step-4-visible', isVisible);
    });
    if (step === 1) updateStep1SubmitState();
    if (step === 2) updateStep2SubmitState();
    if (step === 3) updateStep3Button();
    if (step === 4) updateStep4Fields();
}

function updateStep1SubmitState() {
    const selected = document.querySelector('input[name="planType"]:checked');
    const btn1 = document.getElementById('btnContinuarStep1');
    if (btn1) btn1.disabled = !selected;
}

function updateStep2SubmitState() {
    const titleEl = document.getElementById('routineTitle');
    const title = titleEl ? titleEl.value.trim() : '';
    const bulletSelected = document.querySelector('input[name="bulletType"]:checked');
    const btn2 = document.getElementById('btnContinuarStep2');
    if (btn2) {
        const canProceed = !!title && !!bulletSelected;
        btn2.disabled = !canProceed;
    }
}

function updateWizardProgress(step) {
    const circles = document.querySelectorAll('.wizard-progress-dots .circle');
    circles.forEach((circle, i) => {
        circle.classList.toggle('done', i + 1 < step);
    });
}

function updateStep3Button() {
    const desc = (document.getElementById('routineDescription') && document.getElementById('routineDescription').value.trim()) || '';
    const obj = (document.getElementById('routineObjectives') && document.getElementById('routineObjectives').value.trim()) || '';
    const reasons = (document.getElementById('routineReasons') && document.getElementById('routineReasons').value.trim()) || '';
    const btn = document.getElementById('btnContinuarStep3');
    if (btn) btn.textContent = (desc || obj || reasons) ? 'Continuar' : 'Pular';
}

function setupStep3Details() {
    const ids = ['routineDescription', 'routineObjectives', 'routineReasons'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            updateStep3Button();
            if (el.hasAttribute('data-autogrow')) {
                el.style.height = 'auto';
                const minH = 56;
                const maxH = 200;
                el.style.height = Math.min(Math.max(el.scrollHeight, minH), maxH) + 'px';
            }
        });
    });

    var btnShowMore = document.getElementById('btnShowMoreDetails');
    var detailsMore = document.getElementById('detailsMore');
    var detailsMoreContent = document.getElementById('detailsMoreContent');
    var btnShowMoreText = btnShowMore && btnShowMore.querySelector('.btn-show-more-text');
    if (btnShowMore && detailsMore && detailsMoreContent) {
        btnShowMore.addEventListener('click', function () {
            var isExpanded = !detailsMoreContent.hidden;
            detailsMoreContent.hidden = isExpanded;
            detailsMore.classList.toggle('expanded', !isExpanded);
            btnShowMore.setAttribute('aria-expanded', !isExpanded);
            if (btnShowMoreText) btnShowMoreText.textContent = isExpanded ? 'Mostrar mais' : 'Mostrar menos';
        });
    }
}

// Dia da semana: 0=Dom, 1=Seg, ..., 6=Sáb (para schedule.weekDays e preview)
const WEEKDAY_NAMES_LONG = { 0: 'domingo', 1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado' };
const WEEKDAY_ABBREV = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };

function formatWeekDaysForPreview(weekDays) {
    if (!weekDays || weekDays.length === 0) return '';
    const sorted = [...weekDays].sort((a, b) => a - b);
    const set = new Set(sorted);
    if (set.size === 2 && set.has(0) && set.has(6)) return 'Final de semana';
    const isConsecutive = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (isConsecutive && sorted.length >= 2) {
        const first = WEEKDAY_ABBREV[sorted[0]];
        const last = WEEKDAY_ABBREV[sorted[sorted.length - 1]];
        return first && last ? `${first} a ${last}` : sorted.map(d => WEEKDAY_ABBREV[d]).filter(Boolean).join(', ');
    }
    if (sorted.length === 1) return WEEKDAY_ABBREV[sorted[0]] || '';
    const parts = sorted.map(d => WEEKDAY_ABBREV[d]).filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1] : parts[0] || '';
}

function getScheduleFromStep4() {
    const planType = (document.querySelector('input[name="planType"]:checked') || {}).value || 'daily';
    const timeEl = document.getElementById('routineTime');
    const timeChoiceAny = document.querySelector('input[name="timeChoice"][value="any"]');
    const schedule = {};
    const useTime = timeEl && !(timeChoiceAny && timeChoiceAny.checked);
    if (useTime && timeEl.value) schedule.time = timeEl.value;

    if (planType === 'daily') {
        const dailyDayTypeAll = document.getElementById('dailyDayTypeAll');
        const dailyDayTypeSpecific = document.getElementById('dailyDayTypeSpecific');
        if (dailyDayTypeSpecific && dailyDayTypeSpecific.checked) {
            const checked = Array.from(document.querySelectorAll('input[name="weekDay"]:checked')).map(c => parseInt(c.value, 10));
            if (checked.length) schedule.weekDays = checked.sort((a, b) => a - b);
        }
        // "Todos os dias" (all): não envia weekDays = todos os dias
    }
    if (planType === 'weekly') {
        const checked = Array.from(document.querySelectorAll('input[name="weekDay"]:checked')).map(c => parseInt(c.value, 10));
        if (checked.length) schedule.weekDays = checked.sort((a, b) => a - b);
    }
    if (planType === 'monthly') {
        const mt = document.querySelector('input[name="monthlyType"]:checked');
        if (mt && mt.value === 'dayOfMonth') {
            const v = (document.getElementById('monthlyDayOfMonth') || {}).value;
            if (v) {
                schedule.monthlyType = 'dayOfMonth';
                schedule.dayOfMonth = parseInt(v, 10);
            }
        } else if (mt && mt.value === 'weekOfMonth') {
            const w = (document.getElementById('monthlyWeekOfMonth') || {}).value;
            const d = (document.getElementById('monthlyDayOfWeek') || {}).value;
            if (w && d) {
                schedule.monthlyType = 'weekOfMonth';
                schedule.weekOfMonth = w === 'last' ? 'last' : parseInt(w, 10);
                schedule.dayOfWeek = parseInt(d, 10);
            }
        }
    }
    return schedule;
}

const MONTH_NAMES_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const WEEKDAY_HEADERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function renderMonthlyDayCalendar(container, onDaySelect) {
    if (!container) return;
    const selectEl = document.getElementById('monthlyDayOfMonth');
    const current = new Date();
    const year = current.getFullYear();
    const month = current.getMonth();
    const monthName = MONTH_NAMES_SHORT[month];
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const selectedDay = selectEl && selectEl.value ? parseInt(selectEl.value, 10) : null;

    let daysHTML = '';
    for (let i = 0; i < firstDay; i++) {
        daysHTML += '<span class="monthly-day-cell monthly-day-cell--empty"></span>';
    }
    for (let d = 1; d <= lastDate; d++) {
        const selected = selectedDay === d ? ' selected' : '';
        daysHTML += `<button type="button" class="monthly-day-cell${selected}" data-day="${d}">${d}</button>`;
    }

    const weekdaysHTML = WEEKDAY_HEADERS.map(h => `<span class="monthly-calendar-weekday">${h}</span>`).join('');

    container.innerHTML = `
        <div class="monthly-calendar-header">${monthName}</div>
        <div class="monthly-calendar-weekdays">${weekdaysHTML}</div>
        <div class="monthly-calendar-grid">${daysHTML}</div>
    `;

    container.querySelectorAll('.monthly-day-cell[data-day]').forEach(cell => {
        cell.addEventListener('click', () => {
            const day = cell.getAttribute('data-day');
            if (!day) return;
            if (selectEl) selectEl.value = day;
            container.querySelectorAll('.monthly-day-cell').forEach(c => c.classList.remove('selected'));
            cell.classList.add('selected');
            updateSchedulePreview();
            updateStep4SubmitState();
            if (typeof onDaySelect === 'function') onDaySelect();
        });
    });
}

function openDayInfoModal() {
    const modal = document.getElementById('dayInfoModal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('day-info-modal--open');
    modal.style.display = 'flex';
    const calendarEl = document.getElementById('monthlyDayCalendarModal');
    if (calendarEl && typeof renderMonthlyDayCalendar === 'function') {
        try {
            renderMonthlyDayCalendar(calendarEl, closeDayInfoModal);
        } catch (err) {
            console.warn('Calendário do modal:', err);
        }
    }
}

function closeDayInfoModal() {
    const modal = document.getElementById('dayInfoModal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('day-info-modal--open');
    modal.style.display = '';
}
window.openDayInfoModal = openDayInfoModal;
window.closeDayInfoModal = closeDayInfoModal;

function updateStep4Fields() {
    const planType = (document.querySelector('input[name="planType"]:checked') || {}).value || 'daily';
    const bulletType = (document.querySelector('input[name="bulletType"]:checked') || {}).value || 'task';

    const timeHint = document.getElementById('timeHint');
    if (timeHint) {
        if (bulletType === 'reminder' || bulletType === 'task') timeHint.textContent = 'Opcional';
        else if (bulletType === 'important') timeHint.textContent = 'Recomendado';
        else timeHint.textContent = 'Obrigatório para compromissos';
    }

    const timeChoiceFixed = document.querySelector('input[name="timeChoice"][value="fixed"]');
    const timePickerWrapper = document.getElementById('timePickerWrapper');
    const timeInput = document.getElementById('routineTime');
    const showPicker = timeChoiceFixed && timeChoiceFixed.checked;
    if (timePickerWrapper) timePickerWrapper.style.display = showPicker ? 'block' : 'none';
    if (!showPicker && timeInput) timeInput.value = '';
    updateTimePickerDisplay();
    if (showPicker && timeInput && timeInput.value) {
        const hourSelect = document.getElementById('timePickerHour');
        const minuteSelect = document.getElementById('timePickerMinute');
        const [h, m] = timeInput.value.split(':');
        if (hourSelect) hourSelect.value = h || '';
        if (minuteSelect) minuteSelect.value = m || '';
    }

    const weekdaysGroup = document.getElementById('step4WeekdaysGroup');
    const dailyDaysWrap = document.getElementById('step4DailyDaysWrap');
    const weeklyDaysWrap = document.getElementById('step4WeeklyDaysWrap');
    const dailySpecificDays = document.getElementById('dailySpecificDays');
    const weekdaysCheckboxesWrap = document.getElementById('weekdaysCheckboxesWrap');
    const dailyDayTypeSpecific = document.getElementById('dailyDayTypeSpecific');
    if (weekdaysGroup) {
        weekdaysGroup.style.display = (planType === 'daily' || planType === 'weekly') ? 'block' : 'none';
        if (dailyDaysWrap) dailyDaysWrap.style.display = planType === 'daily' ? 'block' : 'none';
        if (weeklyDaysWrap) weeklyDaysWrap.style.display = planType === 'weekly' ? 'block' : 'none';
        const isDailySpecific = planType === 'daily' && dailyDayTypeSpecific && dailyDayTypeSpecific.checked;
        if (dailySpecificDays) dailySpecificDays.style.display = (planType === 'daily' && isDailySpecific) ? 'block' : 'none';
        if (weekdaysCheckboxesWrap) weekdaysCheckboxesWrap.style.display = (isDailySpecific || planType === 'weekly') ? 'block' : 'none';
    }
    const monthlyGroup = document.getElementById('step4MonthlyGroup');
    if (monthlyGroup) monthlyGroup.style.display = planType === 'monthly' ? 'block' : 'none';

    const mt = document.querySelector('input[name="monthlyType"]:checked');
    const dayFixed = document.getElementById('monthlyDayFixed');
    const weekPattern = document.getElementById('monthlyWeekPattern');
    if (dayFixed) dayFixed.style.display = (mt && mt.value === 'dayOfMonth') ? 'flex' : 'none';
    if (weekPattern) weekPattern.style.display = (mt && mt.value === 'weekOfMonth') ? 'flex' : 'none';

    const calendarEl = document.getElementById('monthlyDayCalendar');
    if (calendarEl && (mt && mt.value === 'dayOfMonth')) renderMonthlyDayCalendar(calendarEl);

    updateSchedulePreview();
    updateStep4SubmitState();
    const warning = document.getElementById('commitmentTimeWarning');
    if (warning) {
        const timeChoiceFixed = document.querySelector('input[name="timeChoice"][value="fixed"]');
        const showPicker = timeChoiceFixed && timeChoiceFixed.checked;
        warning.style.display = (bulletType === 'commitment' && !showPicker) ? 'block' : 'none';
    }
    const lucideLib = typeof lucide !== 'undefined' ? lucide : (typeof Lucide !== 'undefined' ? Lucide : null);
    if (lucideLib && lucideLib.createIcons) lucideLib.createIcons();
}

function formatTimeForPreview(t) {
    if (!t) return '';
    const parts = String(t).split(':');
    return (parts[0] || '00') + ':' + (parts[1] || '00');
}

function updateSchedulePreview() {
    const el = document.getElementById('schedulePreview');
    if (!el) return;
    const timeChoiceChecked = document.querySelector('input[name="timeChoice"]:checked');
    const planType = (document.querySelector('input[name="planType"]:checked') || {}).value || 'daily';
    const schedule = getScheduleFromStep4();
    const dailyDayTypeSpecific = document.getElementById('dailyDayTypeSpecific');
    const dailyNoDayType = planType === 'daily' && !document.querySelector('input[name="dailyDayType"]:checked');
    const dailySpecificNoDays = planType === 'daily' && dailyDayTypeSpecific && dailyDayTypeSpecific.checked && (!schedule.weekDays || schedule.weekDays.length === 0);
    const weeklyNoDays = planType === 'weekly' && (!schedule.weekDays || schedule.weekDays.length === 0);
    const monthlyIncomplete = planType === 'monthly' && (
        !schedule.monthlyType ||
        (schedule.monthlyType === 'dayOfMonth' && !schedule.dayOfMonth) ||
        (schedule.monthlyType === 'weekOfMonth' && (schedule.weekOfMonth == null || schedule.weekOfMonth === '' || schedule.dayOfWeek == null || schedule.dayOfWeek === ''))
    );
    const nothingSelected = !timeChoiceChecked || dailyNoDayType || dailySpecificNoDays || weeklyNoDays || monthlyIncomplete;
    if (nothingSelected) {
        el.textContent = 'Selecione as opções acima para ver como ficará sua rotina.';
        return;
    }
    let text = '';
    const timeStr = schedule.time ? formatTimeForPreview(schedule.time) : '';
    const anyTimeStr = ', pode ser feita a qualquer horário';
    if (planType === 'daily') {
        if (schedule.weekDays && schedule.weekDays.length === 7) {
            if (schedule.time) {
                text = `Essa rotina acontecerá todos os dias às ${timeStr}`;
            } else {
                text = `Essa rotina acontecerá todos os dias, sem horário fixo.`;
            }
        } else if (schedule.weekDays && schedule.weekDays.length) {
            const days = formatWeekDaysForPreview(schedule.weekDays);
            const isRange = days.indexOf(' a ') !== -1;
            const isWeekend = days === 'Final de semana';
            const dayPart = isWeekend ? 'no ' + days : (isRange ? 'de ' + days : 'às ' + days);
            if (schedule.time) {
                text = `Essa rotina acontecerá ${dayPart} às ${timeStr}`;
            } else {
                text = `Essa rotina acontecerá ${dayPart}, sem horário fixo.`;
            }
        } else {
            if (schedule.time) {
                text = `Essa rotina acontecerá todos os dias às ${timeStr}`;
            } else {
                text = `Essa rotina acontecerá todos os dias, sem horário fixo.`;
            }
        }
    } else if (planType === 'weekly' && schedule.weekDays && schedule.weekDays.length) {
        const days = formatWeekDaysForPreview(schedule.weekDays);
        if (!days) { el.textContent = text; return; }
        const isRange = days.indexOf(' a ') !== -1;
        const isWeekend = days === 'Final de semana';
        const dayPart = isWeekend ? 'no ' + days : (isRange ? 'de ' + days : 'aos ' + days);
        if (schedule.time) {
            text = `Toda semana, ${dayPart} às ${timeStr}`;
        } else {
            text = `Toda semana, ${dayPart}, sem horário fixo.`;
        }
    } else if (planType === 'monthly') {
        if (schedule.monthlyType === 'dayOfMonth' && schedule.dayOfMonth) {
            if (schedule.time) {
                text = `Todo mês, no dia ${schedule.dayOfMonth} às ${timeStr}`;
            } else {
                text = `Todo mês, no dia ${schedule.dayOfMonth}, sem horário fixo.`;
            }
        } else if (schedule.monthlyType === 'weekOfMonth' && schedule.weekOfMonth != null && schedule.dayOfWeek != null) {
            const ord = schedule.weekOfMonth === 'last' ? 'última' : `${schedule.weekOfMonth}ª`;
            const dayName = schedule.dayOfWeek >= 1 && schedule.dayOfWeek <= 5
                ? WEEKDAY_NAMES_LONG[schedule.dayOfWeek] + '-feira'
                : (WEEKDAY_NAMES_LONG[schedule.dayOfWeek] || '');
            if (schedule.time) {
                text = `Toda ${ord} ${dayName} do mês às ${timeStr}`;
            } else {
                text = `Toda ${ord} ${dayName} do mês, sem horário fixo.`;
            }
        }
    }
    el.textContent = text || '';
}

function updateTimePickerDisplay() {
    const timeInput = document.getElementById('routineTime');
    const valueEl = document.getElementById('timePickerValue');
    const displayEl = document.getElementById('timeChoiceValueDisplay');
    const displayBig = document.getElementById('timePickerDisplayBig');
    const str = timeInput ? timeInput.value : '';
    if (valueEl) valueEl.textContent = str;
    if (displayEl) displayEl.textContent = str;
    if (displayBig) displayBig.textContent = str || '--:--';
}

function initTimePickerPanel() {
    const hourSelect = document.getElementById('timePickerHour');
    const minuteSelect = document.getElementById('timePickerMinute');
    if (!hourSelect || !minuteSelect) return;
    hourSelect.innerHTML = '<option value="">—</option>' + Array.from({ length: 24 }, (_, i) => {
        const v = String(i).padStart(2, '0');
        return `<option value="${v}">${v}</option>`;
    }).join('');
    minuteSelect.innerHTML = '<option value="">—</option>' + Array.from({ length: 60 }, (_, i) => {
        const v = String(i).padStart(2, '0');
        return `<option value="${v}">${v}</option>`;
    }).join('');
}

function openTimePickerPanel() {
    const panel = document.getElementById('timePickerPanel');
    const timeInput = document.getElementById('routineTime');
    const hourSelect = document.getElementById('timePickerHour');
    const minuteSelect = document.getElementById('timePickerMinute');
    if (!panel || !timeInput || !hourSelect || !minuteSelect) return;
    const v = timeInput.value;
    if (v) {
        const [h, m] = v.split(':');
        hourSelect.value = h || '';
        minuteSelect.value = m || '';
    } else {
        hourSelect.value = '';
        minuteSelect.value = '';
    }
    panel.classList.add('time-picker-panel--open');
}

function closeTimePickerPanel() {
    const panel = document.getElementById('timePickerPanel');
    if (panel) panel.classList.remove('time-picker-panel--open');
}

function applyTimeFromPanel() {
    const hourSelect = document.getElementById('timePickerHour');
    const minuteSelect = document.getElementById('timePickerMinute');
    const timeInput = document.getElementById('routineTime');
    if (!hourSelect || !minuteSelect || !timeInput) return;
    const h = hourSelect.value;
    const m = minuteSelect.value;
    if (h && m) {
        timeInput.value = `${h}:${m}`;
        updateTimePickerDisplay();
        updateSchedulePreview();
    } else {
        timeInput.value = '';
        updateTimePickerDisplay();
        updateSchedulePreview();
    }
}

function updateStep4SubmitState() {
    const btn = document.getElementById('btnCreateRoutine');
    if (!btn) return;
    const timeChoiceChecked = document.querySelector('input[name="timeChoice"]:checked');
    const noTimeChoice = !timeChoiceChecked;
    const planType = (document.querySelector('input[name="planType"]:checked') || {}).value || 'daily';
    const schedule = getScheduleFromStep4();
    const dailyDayTypeSpecific = document.getElementById('dailyDayTypeSpecific');
    const dailyNoDayType = planType === 'daily' && !document.querySelector('input[name="dailyDayType"]:checked');
    const dailySpecificNoDays = planType === 'daily' && dailyDayTypeSpecific && dailyDayTypeSpecific.checked && (!schedule.weekDays || schedule.weekDays.length === 0);
    const weeklyNoDays = planType === 'weekly' && (!schedule.weekDays || schedule.weekDays.length === 0);
    const monthlyIncomplete = planType === 'monthly' && (
        !schedule.monthlyType ||
        (schedule.monthlyType === 'dayOfMonth' && !schedule.dayOfMonth) ||
        (schedule.monthlyType === 'weekOfMonth' && (schedule.weekOfMonth == null || schedule.weekOfMonth === '' || schedule.dayOfWeek == null || schedule.dayOfWeek === ''))
    );
    btn.disabled = !!noTimeChoice || !!dailyNoDayType || !!dailySpecificNoDays || !!weeklyNoDays || !!monthlyIncomplete;
    const hintEmpty = document.getElementById('weekdaysHintEmpty');
    const weekdaysGroup = document.getElementById('step4WeekdaysGroup');
    if (hintEmpty && weekdaysGroup) {
        const showHint = (planType === 'weekly' && weeklyNoDays) || (planType === 'daily' && dailyDayTypeSpecific && dailyDayTypeSpecific.checked && (!schedule.weekDays || schedule.weekDays.length === 0));
        hintEmpty.style.display = showHint ? 'block' : 'none';
    }
}

function setupStep4Listeners() {
    const timePickerWrapper = document.getElementById('timePickerWrapper');
    const timeInput = document.getElementById('routineTime');
    var timeChoiceClickedRadio = null;
    var timeChoiceCheckedBefore = false;
    document.addEventListener('mousedown', function (e) {
        const label = e.target && e.target.closest && e.target.closest('#routineTimeGroup label.time-choice-option');
        if (!label) return;
        const radio = label.querySelector && label.querySelector('input[name="timeChoice"]');
        timeChoiceClickedRadio = radio || null;
        timeChoiceCheckedBefore = radio ? radio.checked : false;
    }, true);
    document.addEventListener('click', function (e) {
        const label = e.target && e.target.closest && e.target.closest('#routineTimeGroup label.time-choice-option');
        if (!label || !timeChoiceClickedRadio) return;
        setTimeout(function () {
            if (timeChoiceClickedRadio.checked && timeChoiceCheckedBefore) {
                timeChoiceClickedRadio.checked = false;
                if (timePickerWrapper) timePickerWrapper.style.display = 'none';
                closeTimePickerPanel();
                if (timeInput) { timeInput.value = ''; updateTimePickerDisplay(); }
                var w = document.getElementById('commitmentTimeWarning');
                if (w) w.style.display = 'none';
                updateSchedulePreview();
                updateStep4SubmitState();
            }
            timeChoiceClickedRadio = null;
        }, 0);
    }, false);
    document.querySelectorAll('input[name="timeChoice"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const fixed = document.querySelector('input[name="timeChoice"][value="fixed"]');
            const showPicker = fixed && fixed.checked;
            if (timePickerWrapper) timePickerWrapper.style.display = showPicker ? 'block' : 'none';
            if (showPicker) {
            } else {
                closeTimePickerPanel();
                if (timeInput) {
                    timeInput.value = '';
                    updateTimePickerDisplay();
                }
            }
            const bulletType = (document.querySelector('input[name="bulletType"]:checked') || {}).value || 'task';
            const warning = document.getElementById('commitmentTimeWarning');
            if (warning) {
                warning.style.display = (bulletType === 'commitment' && !showPicker) ? 'block' : 'none';
            }
            updateSchedulePreview();
            updateStep4SubmitState();
        });
    });
    // Delegação: ao clicar no label "Definir horário" ou nos spans (texto, radio), abrir wrapper e painel
    const routineTimeGroup = document.getElementById('routineTimeGroup');
    const timeChoiceFixed = document.getElementById('timeChoiceFixed');
    /* Card de horário aparece ao selecionar "Horário fixo diário" (display controlado pelo change do radio) */
    initTimePickerPanel();
    const timePickerPanel = document.getElementById('timePickerPanel');
    const hourSelect = document.getElementById('timePickerHour');
    const minuteSelect = document.getElementById('timePickerMinute');
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('timePickerPanel');
        const wrapper = document.getElementById('timePickerWrapper');
        if (panel && panel.classList.contains('time-picker-panel--open') && wrapper && !wrapper.contains(e.target)) {
            closeTimePickerPanel();
        }
    });
    if (hourSelect) {
        hourSelect.addEventListener('change', applyTimeFromPanel);
    }
    if (minuteSelect) {
        minuteSelect.addEventListener('change', applyTimeFromPanel);
    }
    if (timeInput) {
        timeInput.addEventListener('change', () => {
            updateTimePickerDisplay();
            updateSchedulePreview();
        });
        timeInput.addEventListener('input', updateTimePickerDisplay);
    }
    // Diário: segundo clique desmarca (toggle)
    var dailyDayTypeClickedRadio = null;
    var dailyDayTypeCheckedBefore = false;
    document.addEventListener('mousedown', function (e) {
        const label = e.target && e.target.closest && e.target.closest('#dailyDayTypeOptions label.daily-day-type-option');
        if (!label) return;
        const radio = label.querySelector && label.querySelector('input[name="dailyDayType"]');
        dailyDayTypeClickedRadio = radio || null;
        dailyDayTypeCheckedBefore = radio ? radio.checked : false;
    }, true);
    document.addEventListener('click', function (e) {
        const label = e.target && e.target.closest && e.target.closest('#dailyDayTypeOptions label.daily-day-type-option');
        if (!label || !dailyDayTypeClickedRadio) return;
        setTimeout(function () {
            if (dailyDayTypeClickedRadio.checked && dailyDayTypeCheckedBefore) {
                dailyDayTypeClickedRadio.checked = false;
                const dailySpecificDays = document.getElementById('dailySpecificDays');
                const weekdaysCheckboxesWrap = document.getElementById('weekdaysCheckboxesWrap');
                if (dailySpecificDays) dailySpecificDays.style.display = 'none';
                if (weekdaysCheckboxesWrap) weekdaysCheckboxesWrap.style.display = 'none';
                updateSchedulePreview();
                updateStep4SubmitState();
            }
            dailyDayTypeClickedRadio = null;
        }, 0);
    }, false);
    document.querySelectorAll('input[name="dailyDayType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const dailySpecificDays = document.getElementById('dailySpecificDays');
            const weekdaysCheckboxesWrap = document.getElementById('weekdaysCheckboxesWrap');
            const specific = document.getElementById('dailyDayTypeSpecific') && document.getElementById('dailyDayTypeSpecific').checked;
            if (dailySpecificDays) dailySpecificDays.style.display = specific ? 'block' : 'none';
            if (weekdaysCheckboxesWrap) weekdaysCheckboxesWrap.style.display = specific ? 'block' : 'none';
            updateSchedulePreview();
            updateStep4SubmitState();
        });
    });
    document.querySelectorAll('input[name="weekDay"]').forEach(cb => {
        cb.addEventListener('change', () => {
            updateSchedulePreview();
            updateStep4SubmitState();
        });
    });
    var monthlyTypeClickedRadio = null;
    var monthlyTypeCheckedBefore = false;
    document.addEventListener('mousedown', function (e) {
        const label = e.target && e.target.closest && e.target.closest('#step4MonthlyGroup label.monthly-type-option');
        if (!label) return;
        const radio = label.querySelector && label.querySelector('input[name="monthlyType"]');
        monthlyTypeClickedRadio = radio || null;
        monthlyTypeCheckedBefore = radio ? radio.checked : false;
    }, true);
    document.addEventListener('click', function (e) {
        const label = e.target && e.target.closest && e.target.closest('#step4MonthlyGroup label.monthly-type-option');
        if (!label || !monthlyTypeClickedRadio) return;
        setTimeout(function () {
            if (monthlyTypeClickedRadio.checked && monthlyTypeCheckedBefore) {
                monthlyTypeClickedRadio.checked = false;
                const dayFixed = document.getElementById('monthlyDayFixed');
                const weekPattern = document.getElementById('monthlyWeekPattern');
                if (dayFixed) dayFixed.style.display = 'none';
                if (weekPattern) weekPattern.style.display = 'none';
                updateSchedulePreview();
                updateStep4SubmitState();
            }
            monthlyTypeClickedRadio = null;
        }, 0);
    }, false);
    document.querySelectorAll('input[name="monthlyType"]').forEach(r => {
        r.addEventListener('change', () => {
            const mt = document.querySelector('input[name="monthlyType"]:checked');
            const dayFixed = document.getElementById('monthlyDayFixed');
            const weekPattern = document.getElementById('monthlyWeekPattern');
            if (dayFixed) dayFixed.style.display = (mt && mt.value === 'dayOfMonth') ? 'flex' : 'none';
            if (weekPattern) weekPattern.style.display = (mt && mt.value === 'weekOfMonth') ? 'flex' : 'none';
            const calendarEl = document.getElementById('monthlyDayCalendar');
            if (calendarEl && mt && mt.value === 'dayOfMonth') renderMonthlyDayCalendar(calendarEl);
            updateSchedulePreview();
            updateStep4SubmitState();
        });
    });
    ['monthlyDayOfMonth', 'monthlyWeekOfMonth', 'monthlyDayOfWeek'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateSchedulePreview);
    });
}

// Renderizar chips de categorias
function renderCategories() {
    const container = document.getElementById('categorySuggestions');
    container.innerHTML = ROUTINE_CATEGORIES.map(cat => `
        <button type="button" class="category-chip" data-category-id="${cat.id}" data-category-name="${escapeHtml(cat.name)}" data-category-icon="${escapeHtml(cat.icon)}">
            <span class="chip-icon"><i data-lucide="${escapeHtml(cat.icon)}"></i></span>
            <span>${escapeHtml(cat.name)}</span>
        </button>
    `).join('');
    const lucideLib = typeof lucide !== 'undefined' ? lucide : (typeof Lucide !== 'undefined' ? Lucide : null);
    if (lucideLib && lucideLib.createIcons) {
        lucideLib.createIcons();
    }
}

// Configurar listeners de seleção de categoria
function setupCategoryListeners() {
    document.querySelectorAll('.category-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const wasSelected = chip.classList.contains('selected');
            document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('selected'));
            if (!wasSelected) {
                chip.classList.add('selected');
                document.getElementById('routineCategory').value = JSON.stringify({
                    id: chip.dataset.categoryId,
                    name: chip.dataset.categoryName,
                    icon: chip.dataset.categoryIcon
                });
            } else {
                document.getElementById('routineCategory').value = '';
            }
        });
    });
}

// Obter categoria selecionada
function getSelectedCategory() {
    const value = document.getElementById('routineCategory').value;
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

// Configurar input de tarefas
function setupTaskInput() {
    const addTaskBtn = document.getElementById('addTaskBtn');
    const newTaskInput = document.getElementById('newTaskInput');

    if (addTaskBtn) addTaskBtn.addEventListener('click', addTask);
    if (newTaskInput) newTaskInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addTask();
        }
    });
}

// Adicionar tarefa
function addTask() {
    const input = document.getElementById('newTaskInput');
    const text = input.value.trim();

    if (!text) {
        return;
    }

    const task = {
        id: Date.now().toString(),
        text: text,
        completed: false,
        completedDates: [],
        createdAt: new Date().toISOString()
    };

    initialTasks.push(task);
    input.value = '';
    renderTasks();
}

// Remover tarefa
function removeTask(taskId) {
    initialTasks = initialTasks.filter(t => t.id !== taskId);
    renderTasks();
}

// Renderizar tarefas
function renderTasks() {
    const tasksList = document.getElementById('tasksList');
    
    if (initialTasks.length === 0) {
        tasksList.innerHTML = '';
        return;
    }

    tasksList.innerHTML = initialTasks.map(task => `
        <div class="task-preview-item">
            <span class="task-preview-text">${escapeHtml(task.text)}</span>
            ${typeof trashBinButtonHTML === 'function' ? trashBinButtonHTML({ className: 'task-preview-remove delete', modifier: 'uiverse-trash-btn--card', dataAttrs: { 'data-task-id': String(task.id) }, ariaLabel: 'Remover tarefa', title: 'Remover tarefa' }) : `<button type="button" class="task-preview-remove" data-task-id="${task.id}">×</button>`}
        </div>
    `).join('');

    // Adicionar event listeners
    document.querySelectorAll('.task-preview-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const taskId = e.currentTarget.dataset.taskId;
            removeTask(taskId);
        });
    });
}

// Carregar rotina para edição
async function loadRoutineForEdit(routineId) {
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

    if (!routine) {
        const routines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
        routine = routines.find(r => r.id === routineId);
    }

    if (routine) {
        if (routine.planType === 'monthly' && routine.schedule) {
            const s = routine.schedule;
            if (s.monthlyType === 'dayOfMonth') {
                delete s.weekOfMonth;
                delete s.dayOfWeek;
            } else if (s.monthlyType === 'weekOfMonth') {
                delete s.dayOfMonth;
            }
        }
        document.getElementById('routineTitle').value = routine.title;
        document.getElementById('routineDescription').value = routine.description || '';
        const planType = routine.planType || 'daily';
        const planRadio = document.querySelector(`input[name="planType"][value="${planType}"]`);
        if (planRadio) planRadio.checked = true;
        const bulletType = routine.bulletType || 'task';
        const bulletRadio = document.querySelector(`input[name="bulletType"][value="${bulletType}"]`);
        if (bulletRadio) bulletRadio.checked = true;
        document.getElementById('routineObjectives').value = routine.objectives || '';
        document.getElementById('routineReasons').value = routine.reasons || '';
        const contextEl = document.getElementById('routineContext');
        if (contextEl) contextEl.value = routine.context || '';
        const timeEl = document.getElementById('routineTime');
        const timeChoiceFixed = document.querySelector('input[name="timeChoice"][value="fixed"]');
        const timeChoiceAny = document.querySelector('input[name="timeChoice"][value="any"]');
        const timePickerWrapper = document.getElementById('timePickerWrapper');
        if (routine.schedule?.time) {
            timeEl.value = routine.schedule.time;
            if (timeChoiceFixed) timeChoiceFixed.checked = true;
            if (timeChoiceAny) timeChoiceAny.checked = false;
            if (timePickerWrapper) timePickerWrapper.style.display = 'inline-flex';
        } else {
            if (timeChoiceFixed) timeChoiceFixed.checked = false;
            if (timeChoiceAny) timeChoiceAny.checked = true;
            timeEl.value = '';
            if (timePickerWrapper) timePickerWrapper.style.display = 'none';
        }
        updateTimePickerDisplay();
        if (routine.schedule?.weekDays && Array.isArray(routine.schedule.weekDays)) {
            document.querySelectorAll('input[name="weekDay"]').forEach(cb => { cb.checked = false; });
            routine.schedule.weekDays.forEach(d => {
                const cb = document.querySelector(`input[name="weekDay"][value="${d}"]`);
                if (cb) cb.checked = true;
            });
            const dailyDayTypeAll = document.getElementById('dailyDayTypeAll');
            const dailyDayTypeSpecific = document.getElementById('dailyDayTypeSpecific');
            if (routine.planType === 'daily' && dailyDayTypeAll && dailyDayTypeSpecific) {
                if (routine.schedule.weekDays.length < 7) {
                    dailyDayTypeSpecific.checked = true;
                    dailyDayTypeAll.checked = false;
                } else {
                    dailyDayTypeAll.checked = true;
                    dailyDayTypeSpecific.checked = false;
                }
            }
        } else if (routine.planType === 'daily') {
            const dailyDayTypeAll = document.getElementById('dailyDayTypeAll');
            const dailyDayTypeSpecific = document.getElementById('dailyDayTypeSpecific');
            if (dailyDayTypeAll) dailyDayTypeAll.checked = true;
            if (dailyDayTypeSpecific) dailyDayTypeSpecific.checked = false;
            document.querySelectorAll('input[name="weekDay"]').forEach(cb => { cb.checked = false; });
        }
        if (routine.schedule?.monthlyType === 'dayOfMonth' && routine.schedule?.dayOfMonth) {
            const radio = document.querySelector('input[name="monthlyType"][value="dayOfMonth"]');
            if (radio) radio.checked = true;
            const sel = document.getElementById('monthlyDayOfMonth');
            if (sel) sel.value = String(routine.schedule.dayOfMonth);
            const dayFixed = document.getElementById('monthlyDayFixed');
            const weekPattern = document.getElementById('monthlyWeekPattern');
            if (dayFixed) dayFixed.style.display = 'flex';
            if (weekPattern) weekPattern.style.display = 'none';
            const calendarEl = document.getElementById('monthlyDayCalendar');
            if (calendarEl) renderMonthlyDayCalendar(calendarEl);
        }
        if (routine.schedule?.monthlyType === 'weekOfMonth') {
            const radio = document.querySelector('input[name="monthlyType"][value="weekOfMonth"]');
            if (radio) radio.checked = true;
            const wSel = document.getElementById('monthlyWeekOfMonth');
            const dSel = document.getElementById('monthlyDayOfWeek');
            if (wSel) wSel.value = routine.schedule.weekOfMonth === 'last' ? 'last' : String(routine.schedule.weekOfMonth);
            if (dSel && routine.schedule.dayOfWeek != null) dSel.value = String(routine.schedule.dayOfWeek);
            const dayFixed = document.getElementById('monthlyDayFixed');
            const weekPattern = document.getElementById('monthlyWeekPattern');
            if (dayFixed) dayFixed.style.display = 'none';
            if (weekPattern) weekPattern.style.display = 'flex';
        }
        if (routine.tasks) {
            initialTasks = routine.tasks;
            renderTasks();
        }
        document.querySelectorAll('.create-title').forEach(el => { el.textContent = 'Editar Rotina'; });
        const submitBtn = document.querySelector('.btn-create');
        if (submitBtn) submitBtn.textContent = 'Salvar Alterações';
    }
}

// Função auxiliar para escapar HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Função para fazer requisições à API
async function apiRequest(endpoint, options = {}) {
    try {
        const token = localStorage.getItem('token');
        const headers = {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
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
        
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            throw new Error('Servidor não disponível');
        }
        
        throw error;
    }
}

// Criar rotina
async function handleCreateRoutine(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (window.__creatingRoutine) return;
    window.__creatingRoutine = true;
    const progressEl = document.getElementById('wizardProgress');
    const btnCreate = document.getElementById('btnCreateRoutine');
    if (progressEl) progressEl.classList.add('wizard-progress--loading');
    if (btnCreate) btnCreate.disabled = true;
    try {
        return await handleCreateRoutineImpl();
    } finally {
        if (progressEl) progressEl.classList.remove('wizard-progress--loading');
        if (btnCreate) btnCreate.disabled = false;
        window.__creatingRoutine = false;
    }
}

window.__doCreateRoutine = function () {
    handleCreateRoutine({ preventDefault: function () {} });
};

async function handleCreateRoutineImpl() {
    const title = (document.getElementById('routineTitle') || {}).value;
    const titleTrimmed = title ? title.trim() : '';
    const description = (document.getElementById('routineDescription') || {}).value || '';
    const category = getSelectedCategory();
    const planType = (document.querySelector('input[name="planType"]:checked') || {}).value || 'daily';
    const bulletType = (document.querySelector('input[name="bulletType"]:checked') || {}).value || 'task';
    const objectives = (document.getElementById('routineObjectives') || {}).value || '';
    const reasons = (document.getElementById('routineReasons') || {}).value || '';
    const context = (document.getElementById('routineContext') || {}).value ? (document.getElementById('routineContext').value || '').trim() : '';

    if (!titleTrimmed) {
        alert('Por favor, preencha o título da rotina (nome da tarefa no passo 2).');
        return;
    }

    let schedule;
    try {
        schedule = getScheduleFromStep4();
    } catch (err) {
        console.error('getScheduleFromStep4:', err);
        alert('Erro ao ler os dados. Tente novamente.');
        return;
    }

    if (bulletType === 'commitment') {
        const timeChoiceAny = document.querySelector('input[name="timeChoice"][value="any"]');
        if (!(timeChoiceAny && timeChoiceAny.checked) && !schedule.time) {
            alert('Para compromissos, defina um horário ou escolha "Pode ser feita a qualquer horário".');
            return;
        }
    }
    if (planType === 'weekly') {
        if (!schedule.weekDays || schedule.weekDays.length === 0) {
            alert('Escolha pelo menos um dia da semana.');
            return;
        }
    }
    if (planType === 'monthly') {
        if (!schedule.monthlyType || (schedule.monthlyType === 'dayOfMonth' && !schedule.dayOfMonth) ||
            (schedule.monthlyType === 'weekOfMonth' && (schedule.weekOfMonth == null || schedule.dayOfWeek == null))) {
            alert('Defina como a rotina se repete no mês: dia fixo ou padrão semanal.');
            return;
        }
    }

    const token = localStorage.getItem('token');
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');

    // Verificar se é edição
    if (editId) {
        // Atualizar rotina existente
        if (token) {
            try {
                await apiRequest(`/routines/${editId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        title: titleTrimmed,
                        description,
                        category,
                        tasks: initialTasks,
                        schedule,
                        planType,
                        objectives,
                        reasons,
                        bulletType,
                        context
                    })
                });
                alert('✅ Rotina atualizada com sucesso!');
                window.location.replace('dashboard.html');
                return;
            } catch (error) {
                console.log('Servidor não disponível, salvando localmente');
            }
        }

        // Atualizar no localStorage
        let routines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
        const index = routines.findIndex(r => r.id === editId);
        if (index !== -1) {
            routines[index] = {
                ...routines[index],
                title: titleTrimmed,
                description,
                category,
                tasks: initialTasks,
                schedule,
                planType,
                objectives,
                reasons,
                bulletType,
                context,
                checkIns: routines[index].checkIns || [], // Manter checkIns existentes
                updatedAt: new Date().toISOString()
            };
            localStorage.setItem('localRoutines', JSON.stringify(routines));
        }
        alert('✅ Rotina atualizada (modo offline)!');
        window.location.replace('dashboard.html');
        return;
    }

    // Criar nova rotina
    if (token) {
        try {
            const routine = await apiRequest('/routines', {
                method: 'POST',
                body: JSON.stringify({
                    title: titleTrimmed,
                    description,
                    category,
                    tasks: initialTasks,
                    schedule,
                    planType,
                    objectives,
                    reasons,
                    bulletType,
                    context
                })
            });

            alert('✅ Rotina criada com sucesso!');
            window.location.replace('dashboard.html');
            return;
        } catch (error) {
            console.log('Servidor não disponível, salvando localmente');
        }
    }

    // Modo offline: salvar localmente
    let routines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
    const newRoutine = {
        id: Date.now().toString(),
        title: titleTrimmed,
        description,
        category,
        tasks: initialTasks,
        schedule,
        planType,
        objectives,
        reasons,
        bulletType,
        context,
        checkIns: [], // Array de datas ISO para tracking de frequência
        completed: false,
        createdAt: new Date().toISOString()
    };
    routines.push(newRoutine);
    localStorage.setItem('localRoutines', JSON.stringify(routines));

    alert('✅ Rotina criada (modo offline)!');
    window.location.replace('dashboard.html');
}
