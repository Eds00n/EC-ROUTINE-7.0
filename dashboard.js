// Configuração da API
const API_URL = 'http://localhost:3000/api';
const MAX_UPLOAD_FILE_SIZE = 20 * 1024 * 1024; // 20 MB (igual ao servidor)

function getApiBaseUrl() {
    if (typeof API_URL !== 'string') return '';
    return API_URL.replace(/\/api\/?$/, '') || '';
}

function getAttachmentFullUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (url.indexOf('http') === 0 || url.indexOf('data:') === 0) return url;
    return getApiBaseUrl() + (url.indexOf('/') === 0 ? '' : '/') + url;
}

function showToast(message, durationMs) {
    var container = document.getElementById('notificationContainer');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'saved-toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function() {
        el.classList.add('saved-toast-out');
        setTimeout(function() {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
    }, durationMs || 3500);
}

function showAnnotationSavingOverlay(message) {
    try {
        var modal = document.getElementById('annotationModal');
        if (!modal) return;
        var content = modal.querySelector('.annotation-modal-content');
        if (!content) return;
        var overlay = document.getElementById('annotationSavingOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'annotationSavingOverlay';
            overlay.className = 'annotation-saving-overlay';
            overlay.setAttribute('role', 'status');
            overlay.setAttribute('aria-live', 'polite');
            overlay.innerHTML =
                '<div class="annotation-saving-spinner" aria-hidden="true"></div>' +
                '<div class="annotation-saving-title" id="annotationSavingOverlayTitle">Salvando…</div>' +
                '<div class="annotation-saving-subtitle">Aguarde um momento.</div>';
            content.appendChild(overlay);
        }
        var t = document.getElementById('annotationSavingOverlayTitle');
        if (t && typeof message === 'string' && message.trim()) t.textContent = message.trim();
        overlay.style.display = 'flex';
    } catch (e) {}
}

function hideAnnotationSavingOverlay() {
    try {
        var overlay = document.getElementById('annotationSavingOverlay');
        if (overlay) overlay.style.display = 'none';
    } catch (e) {}
}

var SYNC_QUEUE_MAX_RETRIES = 5;
var SYNC_QUEUE_INTERVAL_MS = 30000;
window._syncQueue = window._syncQueue || [];

function addToSyncQueue(method, url, body, headers) {
    window._syncQueue.push({
        method: method,
        url: url,
        body: body,
        headers: headers || {},
        retries: 0
    });
    try {
        localStorage.setItem('ecRoutineSyncQueue', JSON.stringify(window._syncQueue));
    } catch (e) {}
}

function processSyncQueue() {
    var token = localStorage.getItem('token');
    var queue = (window._syncQueue || []).slice();
    window._syncQueue = [];
    queue.forEach(function(item) {
        if (item.retries >= SYNC_QUEUE_MAX_RETRIES) return;
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        Object.keys(item.headers || {}).forEach(function(k) {
            if (k.toLowerCase() !== 'authorization') headers[k] = item.headers[k];
        });
        fetch(item.url, { method: item.method, headers: headers, body: item.body })
            .then(function(res) {
                if (res.status === 401) return;
                if (res.ok) return;
                item.retries++;
                if (item.retries < SYNC_QUEUE_MAX_RETRIES) window._syncQueue.push(item);
            })
            .catch(function() {
                item.retries++;
                if (item.retries < SYNC_QUEUE_MAX_RETRIES) window._syncQueue.push(item);
            });
    });
    try {
        localStorage.setItem('ecRoutineSyncQueue', JSON.stringify(window._syncQueue));
    } catch (e) {}
}

/** Envia ficheiro para o servidor e devolve { attachmentId, url } ou null. Requer token. */
async function uploadMentalImage(file) {
    var token = localStorage.getItem('token');
    if (!token || !file) return null;
    if (file.size > MAX_UPLOAD_FILE_SIZE) {
        showToast('Este ficheiro é demasiado grande. Máximo 20 MB.');
        return null;
    }
    var form = new FormData();
    form.append('file', file);
    try {
        var res = await fetch(API_URL + '/uploads', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
            body: form
        });
        if (res.status === 413) {
            var errJson = await res.json().catch(function() { return {}; });
            showToast(errJson.error || 'Ficheiro demasiado grande. Máximo 20 MB.');
            return null;
        }
        if (!res.ok) return null;
        var json = await res.json();
        if (json && json.attachmentId && json.url) return { attachmentId: json.attachmentId, url: json.url };
    } catch (e) {}
    return null;
}

async function waitForMentalImageUploads() {
    // Aguarda uploads iniciados durante a edição do mapa mental.
    // Isso evita que o usuário clique "Salvar" enquanto a referência do anexo ainda não veio.
    try {
        var data = window._annotationMentalData;
        if (!data || !data.nodes || !Array.isArray(data.nodes)) return;
        var pending = data.nodes
            .map(function(n) { return n && n._annotationMentalImageUploadPromise ? n._annotationMentalImageUploadPromise : null; })
            .filter(Boolean);
        if (pending.length) await Promise.all(pending);
    } catch (e) {}
}

function dataURLToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    var parts = dataUrl.split(',');
    if (parts.length !== 2) return null;
    var m = parts[0].match(/data:([^;]+);base64/);
    var type = (m && m[1]) ? m[1].trim() : 'image/png';
    try {
        var binary = atob(parts[1]);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: type });
    } catch (e) { return null; }
}

function escapeXmlAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function triggerDownloadBlob(blob, filename) {
    if (!blob) return;
    try {
        var a = document.createElement('a');
        var url = URL.createObjectURL(blob);
        a.href = url;
        a.download = filename || 'download';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
            try {
                URL.revokeObjectURL(url);
            } catch (e) {}
        }, 2500);
    } catch (e) {}
}

function sanitizeDownloadBasename(name) {
    var s = String(name || 'anexo')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 72);
    return s || 'anexo';
}

function findAnnotationForDownload(routineId, taskId, dateStr, annIndex) {
    var routine = (allRoutines || []).find(function (r) {
        return String(r.id) === String(routineId);
    });
    var task = routine && routine.tasks ? routine.tasks.find(function (t) {
        return String(t.id) === String(taskId);
    }) : null;
    if (!task) return null;
    var list = getTaskAnnotationsListForDate(task, dateStr);
    var idx = parseInt(annIndex, 10);
    if (isNaN(idx) || idx < 0 || !list || idx >= list.length) return null;
    return { ann: list[idx], routine: routine, task: task };
}

/** True se o modal do diagrama está aberto na mesma anotação que o pedido de download. */
function canUseLiveMentalExport(routineId, taskId, dateStr, annIndex) {
    var modal = document.getElementById('annotationModal');
    if (!modal || modal.classList.contains('hidden')) return false;
    if (!modal.classList.contains('annotation-modal--mental')) return false;
    if (!annotationModalContext || annotationModalContext.type !== 'mental') return false;
    if (String(annotationModalContext.routineId) !== String(routineId)) return false;
    if (String(annotationModalContext.taskId) !== String(taskId)) return false;
    if (String(annotationModalContext.annotationDate || '') !== String(dateStr || '')) return false;
    var idx = parseInt(annIndex, 10);
    if (isNaN(idx) || idx < 0) return false;
    var task = annotationModalContext.task;
    if (!task || typeof getTaskAnnotationsListForDate !== 'function') return false;
    var list = getTaskAnnotationsListForDate(task, annotationModalContext.annotationDate);
    if (!list || idx >= list.length) return false;
    return true;
}

async function fetchUrlAsBlob(url) {
    if (!url || typeof url !== 'string') return null;
    var full = getAttachmentFullUrl(url);
    var token = localStorage.getItem('token');
    var headers = {};
    if (token && full.indexOf('/api/') !== -1) headers.Authorization = 'Bearer ' + token;
    try {
        var res = await fetch(full, { headers: headers });
        if (!res.ok) return null;
        return await res.blob();
    } catch (e) {
        return null;
    }
}

function mentalFirstImageDataUrl(parsed) {
    if (!parsed || !parsed.nodes || !Array.isArray(parsed.nodes)) return null;
    for (var i = 0; i < parsed.nodes.length; i++) {
        var n = parsed.nodes[i];
        if (!n) continue;
        if (n.imageData && typeof n.imageData === 'string' && n.imageData.indexOf('data:image') === 0) return n.imageData;
    }
    return null;
}

async function mentalFirstImageBlobFromUrl(parsed) {
    if (!parsed || !parsed.nodes || !Array.isArray(parsed.nodes)) return null;
    for (var i = 0; i < parsed.nodes.length; i++) {
        var n = parsed.nodes[i];
        if (!n || !n.image || !n.image.url) continue;
        var b = await fetchUrlAsBlob(n.image.url);
        if (b) return b;
    }
    return null;
}

function wrapRasterInSvgDataUrl(dataUrl, w, h) {
    var href = escapeXmlAttr(dataUrl);
    return (
        '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' +
        (w || 800) +
        '" height="' +
        (h || 600) +
        '"><rect width="100%" height="100%" fill="#ffffff"/><image width="100%" height="100%" href="' +
        href +
        '" preserveAspectRatio="xMidYMid meet"/></svg>'
    );
}

function digitalizandoToSvgString(html) {
    var body = String(html || '');
    var cdata = body.replace(/\]\]>/g, ']]]]><![CDATA[>');
    return (
        '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="816" height="1200"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:16px;font-family:system-ui,sans-serif;font-size:15px;background:#fff;color:#111;overflow:auto;"><![CDATA[' +
        cdata +
        ']]></div></foreignObject></svg>'
    );
}

function svgStringToPngBlob(svgStr, callback) {
    var img = new Image();
    var blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    img.onload = function () {
        try {
            var w = Math.min(Math.max(img.naturalWidth || 816, 400), 2400);
            var h = Math.min(Math.max(img.naturalHeight || 1200, 300), 3200);
            var c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            c.toBlob(function (b) {
                URL.revokeObjectURL(url);
                callback(b);
            }, 'image/png');
        } catch (e) {
            URL.revokeObjectURL(url);
            callback(null);
        }
    };
    img.onerror = function () {
        URL.revokeObjectURL(url);
        callback(null);
    };
    img.src = url;
}

async function downloadAnnotationAttachment(routineId, taskId, dateStr, annIndex, format) {
    var found = findAnnotationForDownload(routineId, taskId, dateStr, annIndex);
    if (!found || !found.ann) {
        showToast('Anotação não encontrada.');
        return;
    }
    var ann = found.ann;
    var base = sanitizeDownloadBasename(ann.name || ANNOTATION_TYPE_NAMES[ann.type] || 'anexo');
    var type = ann.type;
    var data = ann.data != null ? ann.data : '';
    if (typeof data !== 'string') {
        try {
            data = JSON.stringify(data);
        } catch (e) {
            data = '';
        }
    }

    if (type === 'caderno') {
        if (data.indexOf('data:image') !== 0) {
            showToast('Caderno sem imagem para exportar.');
            return;
        }
        if (format === 'png') {
            var blobP = dataURLToBlob(data);
            triggerDownloadBlob(blobP, base + '.png');
            return;
        }
        if (format === 'svg') {
            triggerDownloadBlob(new Blob([wrapRasterInSvgDataUrl(data, 800, 600)], { type: 'image/svg+xml' }), base + '.svg');
            return;
        }
    }

    if (type === 'digitalizando') {
        if (!data || !data.trim()) {
            showToast('Conteúdo vazio.');
            return;
        }
        if (format === 'svg') {
            triggerDownloadBlob(new Blob([digitalizandoToSvgString(data)], { type: 'image/svg+xml' }), base + '.svg');
            return;
        }
        if (format === 'png') {
            svgStringToPngBlob(digitalizandoToSvgString(data), function (b) {
                if (b) triggerDownloadBlob(b, base + '.png');
                else showToast('Não foi possível gerar PNG (tente SVG).');
            });
            return;
        }
    }

    if (type === 'mental') {
        var parsed = null;
        try {
            parsed = JSON.parse(data);
        } catch (e) {}
        if (!parsed) {
            showToast('Diagrama inválido.');
            return;
        }

        if (format === 'svg' && typeof MentalDiagramSvgExport !== 'undefined') {
            try {
                if (canUseLiveMentalExport(routineId, taskId, dateStr, annIndex)) {
                    var svgCanvas = document.getElementById('annotationMentalCanvas');
                    var svgCenter = document.getElementById('annotationMentalCenter');
                    var svgBranches = document.getElementById('annotationMentalBranches');
                    var svgStr = await MentalDiagramSvgExport.buildSvgFromLiveDom({
                        canvas: svgCanvas,
                        centerEl: svgCenter,
                        branchesEl: svgBranches,
                        data: window._annotationMentalData,
                        pan: window._annotationMentalPan || { x: 0, y: 0 },
                        zoom: typeof window._annotationMentalZoom === 'number' && window._annotationMentalZoom > 0 ? window._annotationMentalZoom : 1
                    });
                    MentalDiagramSvgExport.downloadSvg(svgStr, base);
                    return;
                }
                var svgFromJson = await MentalDiagramSvgExport.buildSvgFromJsonData(parsed);
                MentalDiagramSvgExport.downloadSvg(svgFromJson, base);
                return;
            } catch (exportErr) {
                console.warn('Exportação SVG completa:', exportErr);
            }
        }

        var legacyUrl = mentalFirstImageDataUrl(parsed);
        if (legacyUrl) {
            if (format === 'png') {
                triggerDownloadBlob(dataURLToBlob(legacyUrl), base + '.png');
            } else {
                triggerDownloadBlob(new Blob([wrapRasterInSvgDataUrl(legacyUrl, 800, 600)], { type: 'image/svg+xml' }), base + '.svg');
            }
            return;
        }
        var imgBlob = await mentalFirstImageBlobFromUrl(parsed);
        if (!imgBlob) {
            showToast(format === 'png' ? 'Este diagrama não tem imagem anexada para exportar.' : 'Não foi possível exportar o diagrama (SVG).');
            return;
        }
        if (format === 'png') {
            triggerDownloadBlob(imgBlob, base + '.png');
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            var du = typeof reader.result === 'string' ? reader.result : '';
            if (du.indexOf('data:') !== 0) {
                showToast('Não foi possível gerar SVG a partir da imagem.');
                return;
            }
            triggerDownloadBlob(new Blob([wrapRasterInSvgDataUrl(du, 800, 600)], { type: 'image/svg+xml' }), base + '.svg');
        };
        reader.readAsDataURL(imgBlob);
        return;
    }

    showToast('Tipo de anotação sem exportação PNG/SVG.');
}

/** Botão único no modal de visualização: só SVG, download imediato ao clicar (sem PNG / sem menu). */
function annotationModalSvgDownloadOnlyHtml(routineId, taskId, dateStr, annIndex) {
    var ds =
        ' data-routine-id="' +
        escapeHtml(String(routineId)) +
        '" data-task-id="' +
        escapeHtml(String(taskId)) +
        '" data-annotation-date="' +
        escapeHtml(String(dateStr)) +
        '" data-date-str="' +
        escapeHtml(String(dateStr)) +
        '" data-annotation-index="' +
        escapeHtml(String(annIndex)) +
        '"';
    return (
        '<div class="annotation-attachment-download-wrap annotation-attachment-download-wrap--modal-svg-only">' +
        '<button type="button" class="uiverse-download-btn annotation-download-svg-direct"' +
        ds +
        ' title="Baixar SVG" aria-label="Baixar SVG">' +
        '<svg class="svgIcon" viewBox="0 0 384 512" height="1em" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M169.4 470.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 370.8 224 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 306.7L54.6 265.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z"></path></svg>' +
        '<span class="icon2" aria-hidden="true"></span>' +
        '<span class="tooltip">SVG</span></button></div>'
    );
}

function closeAllAnnotationDownloadFlyouts() {
    document.querySelectorAll('.annotation-download-flyout').forEach(function (el) {
        el.hidden = true;
    });
    document.querySelectorAll('.annotation-download-trigger[aria-expanded="true"]').forEach(function (b) {
        b.setAttribute('aria-expanded', 'false');
    });
}

function setupAnnotationDownloadUi() {
    if (window._ecAnnotationDownloadUiBound) return;
    window._ecAnnotationDownloadUiBound = true;
    document.body.addEventListener('click', function (e) {
        var directSvg = e.target.closest('.annotation-download-svg-direct');
        if (directSvg) {
            e.preventDefault();
            e.stopPropagation();
            closeAllAnnotationDownloadFlyouts();
            var rid = directSvg.getAttribute('data-routine-id');
            var tid = directSvg.getAttribute('data-task-id');
            var dstr = directSvg.getAttribute('data-date-str') || directSvg.getAttribute('data-annotation-date');
            var idx = directSvg.getAttribute('data-annotation-index');
            downloadAnnotationAttachment(rid, tid, dstr, idx, 'svg');
            return;
        }
        var fmt = e.target.closest('.annotation-download-format');
        if (fmt) {
            e.preventDefault();
            e.stopPropagation();
            var rid = fmt.getAttribute('data-routine-id');
            var tid = fmt.getAttribute('data-task-id');
            var dstr = fmt.getAttribute('data-date-str') || fmt.getAttribute('data-annotation-date');
            var idx = fmt.getAttribute('data-annotation-index');
            var f = fmt.getAttribute('data-format');
            closeAllAnnotationDownloadFlyouts();
            downloadAnnotationAttachment(rid, tid, dstr, idx, f);
            return;
        }
        var trig = e.target.closest('.annotation-download-trigger');
        if (trig) {
            e.preventDefault();
            e.stopPropagation();
            var wrap = trig.closest('.annotation-attachment-download-wrap');
            var fly = wrap && wrap.querySelector('.annotation-download-flyout');
            var open = fly && fly.hidden;
            closeAllAnnotationDownloadFlyouts();
            if (fly && open) {
                fly.hidden = false;
                trig.setAttribute('aria-expanded', 'true');
            }
            return;
        }
        if (!e.target.closest('.annotation-attachment-download-wrap')) closeAllAnnotationDownloadFlyouts();
    });
}

/** Envia imagens em base64 (legado) dos nós do mapa mental para o servidor e substitui por referência. Requer token. */
async function uploadLegacyBase64InMental() {
    var data = window._annotationMentalData;
    var token = localStorage.getItem('token');
    if (!token || !data || !data.nodes) return;
    for (var i = 0; i < data.nodes.length; i++) {
        var node = data.nodes[i];
        if (!node.imageData || (node.image && node.image.url)) continue;
        var blob = dataURLToBlob(node.imageData);
        if (!blob) continue;
        var file = new File([blob], 'image.png', { type: blob.type || 'image/png' });
        var ref = await uploadMentalImage(file);
        if (ref) {
            node.image = { attachmentId: ref.attachmentId, url: ref.url };
            delete node.imageData;
        }
    }
}

/** Remove base64 (imageData) de anotações mental em rotinas para não estourar localStorage. */
function stripBase64FromRoutines(routines) {
    if (!Array.isArray(routines)) return routines;
    var out = routines.map(function (r) {
        var routine = { ...r };
        if (Array.isArray(routine.tasks)) {
            routine.tasks = routine.tasks.map(function (t) {
                var task = { ...t };
                if (task.annotationsByDate && typeof task.annotationsByDate === 'object') {
                    task.annotationsByDate = { ...task.annotationsByDate };
                    Object.keys(task.annotationsByDate).forEach(function (dateStr) {
                        var list = task.annotationsByDate[dateStr];
                        if (!Array.isArray(list)) return;
                        task.annotationsByDate[dateStr] = list.map(function (ann) {
                            if (ann.type !== 'mental' || !ann.data) return ann;
                            try {
                                var parsed = JSON.parse(ann.data);
                                if (parsed && parsed.nodes && Array.isArray(parsed.nodes)) {
                                    parsed.nodes = parsed.nodes.map(function (node) {
                                        var n = { ...node };
                                        // Só remover base64 se já existir referência de upload; senão a imagem sumiria
                                        if (n.image && n.image.url) delete n.imageData;
                                        return n;
                                    });
                                    return { ...ann, data: JSON.stringify(parsed) };
                                }
                            } catch (e) {}
                            return ann;
                        });
                    });
                }
                return task;
            });
        }
        return routine;
    });
    return out;
}

// Verificar autenticação e carregar dados
document.addEventListener('DOMContentLoaded', async () => {
    try {
        var saved = localStorage.getItem('ecRoutineSyncQueue');
        if (saved) window._syncQueue = JSON.parse(saved);
    } catch (e) {}
    setInterval(function() {
        if (typeof processSyncQueue === 'function') processSyncQueue();
    }, SYNC_QUEUE_INTERVAL_MS);

    setupAnnotationDownloadUi();

    // Anexar botões de navegação logo no início para não depender do resto do carregamento
    const btnVerRotinas = document.getElementById('btnVerRotinas');
    if (btnVerRotinas) {
        btnVerRotinas.addEventListener('click', (e) => { e.preventDefault(); showRotinasView(); });
    }
    const btnVoltarDashboard = document.getElementById('btnVoltarDashboard');
    if (btnVoltarDashboard) {
        btnVoltarDashboard.addEventListener('click', (e) => { e.preventDefault(); showDashboardOverview(); });
    }

    // Delegação de eventos na view de rotinas (fallback para view-toggle e filtros)
    const rotinasViewEl = document.getElementById('rotinasView');
    if (rotinasViewEl) {
        rotinasViewEl.addEventListener('click', function(e) {
            const openAnnBtn = e.target.closest('.agenda-open-annotation');
            if (openAnnBtn) {
                e.preventDefault();
                const routineId = openAnnBtn.dataset.routineId;
                const taskId = openAnnBtn.dataset.taskId;
                const dateStr = openAnnBtn.dataset.annotationDate || getLocalDateStr(new Date());
                const annIndex = parseInt(openAnnBtn.dataset.annotationIndex, 10) || 0;
                const routine = typeof allRoutines !== 'undefined' && allRoutines.find(r => r.id === routineId);
                const task = routine && routine.tasks ? routine.tasks.find(t => t.id === taskId) : null;
                if (routine && task && typeof openAnnotationViewer === 'function') {
                    const annotations = getTaskAnnotationsListForDate(task, dateStr);
                    if (annotations && annotations.length > 0) openAnnotationViewer({ routine: routine, task: task, dateStr: dateStr, annotations: annotations }, annIndex);
                }
                return;
            }
            const annotationBtn = e.target.closest('.agenda-annotation-btn');
            if (annotationBtn) {
                e.preventDefault();
                const routineId = annotationBtn.dataset.routineId;
                const taskId = annotationBtn.dataset.taskId;
                const annotationDate = annotationBtn.dataset.annotationDate || getLocalDateStr(new Date());
                const routine = typeof allRoutines !== 'undefined' && allRoutines.find(r => r.id === routineId);
                let task = routine && routine.tasks ? routine.tasks.find(t => t.id === taskId) : null;
                if (!task && routine && (taskId === routineId + '-new' || String(taskId).endsWith('-new'))) {
                    task = { id: taskId, text: routine.title || 'Rotina', _synthetic: true };
                }
                if (routine && task && typeof openAnnotationModal === 'function') openAnnotationModal(routineId, taskId, task, annotationDate);
                return;
            }
            const menuBtn = e.target.closest('.agenda-task-menu-btn');
            if (menuBtn) {
                e.preventDefault();
                e.stopPropagation();
                var routineId = menuBtn.dataset.routineId;
                var taskId = menuBtn.dataset.taskId;
                var dateStr = menuBtn.dataset.annotationDate || getLocalDateStr(new Date());
                openAgendaTaskMenu(menuBtn, routineId, taskId, dateStr);
                return;
            }
            if (e.target.closest('.agenda-menu-dropdown') || e.target.closest('.agenda-history-modal')) return;
            closeAgendaTaskMenu();
            const viewBtn = e.target.closest('.view-btn[data-view]');
            const filterBtn = e.target.closest('.filter-btn[data-filter]');
            if (viewBtn) {
                e.preventDefault();
                const view = viewBtn.dataset.view;
                if (view === 'dashboard') {
                    showDashboardOverview();
                    return;
                }
                const cardsViewBtn = document.getElementById('cardsViewBtn');
                const calendarViewBtn = document.getElementById('calendarViewBtn');
                const agendaViewBtn = document.getElementById('agendaViewBtn');
                const dashboardLayout = document.querySelector('.dashboard-layout');
                const routinesGrid = document.getElementById('routinesGrid');
                const calendarView = document.getElementById('calendarView');
                const agendaView = document.getElementById('agendaView');
                rotinasViewEl.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                viewBtn.classList.add('active');
                if (view === 'cards') {
                    if (dashboardLayout) dashboardLayout.classList.remove('hidden');
                    if (routinesGrid) routinesGrid.classList.remove('hidden');
                    if (calendarView) calendarView.classList.add('hidden');
                    if (agendaView) agendaView.classList.add('hidden');
                } else if (view === 'calendar') {
                    if (dashboardLayout) dashboardLayout.classList.add('hidden');
                    if (routinesGrid) routinesGrid.classList.add('hidden');
                    if (calendarView) calendarView.classList.remove('hidden');
                    if (agendaView) agendaView.classList.add('hidden');
                    if (typeof renderCalendar === 'function') renderCalendar();
                } else if (view === 'agenda') {
                    if (dashboardLayout) dashboardLayout.classList.add('hidden');
                    if (routinesGrid) routinesGrid.classList.add('hidden');
                    if (calendarView) calendarView.classList.add('hidden');
                    if (agendaView) agendaView.classList.remove('hidden');
                    if (typeof renderAgenda === 'function') renderAgenda();
                }
            }
            if (filterBtn) {
                e.preventDefault();
                rotinasViewEl.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
                filterBtn.classList.add('active');
                if (typeof applyVerTodasFilters === 'function') applyVerTodasFilters(filterBtn.dataset.filter);
                setTimeout(function() { if (typeof reapplyAllHeatmapPositions === 'function') reapplyAllHeatmapPositions(); }, 300);
            }
        });
    }

    // auth-guard.js já redireciona para /register sem token; aqui assumimos sessão válida ou verificação abaixo.
    const usernameElement = document.getElementById('username');
    const userNameStored = localStorage.getItem('userName');
    if (usernameElement) {
        usernameElement.textContent = (userNameStored || 'Utilizador').toUpperCase();
    }

    const token = localStorage.getItem('token');
    if (token) {
        try {
            const response = await apiRequest('/verify');
            if (response.user && response.user.name && usernameElement) {
                usernameElement.textContent = response.user.name.toUpperCase();
                localStorage.setItem('userName', response.user.name);
            }
        } catch (error) {
            const em = String((error && error.message) || '').toLowerCase();
            if (em.indexOf('token') !== -1 || em.indexOf('inválido') !== -1 || em.indexOf('fornecido') !== -1) {
                localStorage.removeItem('token');
                localStorage.removeItem('userName');
                localStorage.removeItem('userId');
                window.location.replace('/login');
                return;
            }
            console.log('Servidor não disponível, usando modo offline');
        }
    }

    // Carregar rotinas (sempre, mesmo sem token)
    await loadRoutines();

    // Configurar controles (com checagem para não quebrar se algum elemento não existir)
    setupControls();
    setupDetailListFilters();
    if (typeof setupAnnotationModal === 'function') setupAnnotationModal();

    // Boas-vindas pós-login (1ª tarefa) ou apresentação diária
    const dashboardOverview = document.getElementById('dashboardOverview');
    const rotinasView = document.getElementById('rotinasView');
    var onboardingRan = false;
    var redirectingToCreateAfterWelcome = false;
    try {
        var postLoginWelcome = false;
        try {
            postLoginWelcome = sessionStorage.getItem('ec_post_login_welcome') === '1';
        } catch (e) {}
        var noRoutines = !allRoutines || allRoutines.length === 0;
        if (postLoginWelcome && noRoutines) {
            try {
                sessionStorage.removeItem('ec_post_login_welcome');
            } catch (e) {}
            if (typeof runPostLoginWelcomeOnboarding === 'function') {
                redirectingToCreateAfterWelcome = !!(await runPostLoginWelcomeOnboarding());
                onboardingRan = redirectingToCreateAfterWelcome;
            }
        } else {
            if (postLoginWelcome) {
                try {
                    sessionStorage.removeItem('ec_post_login_welcome');
                } catch (e) {}
            }
            if (typeof runDailyOnboarding === 'function') onboardingRan = await runDailyOnboarding();
        }
    } catch (e) {}

    // Evita mostrar o dashboard por um instante antes do redirect para /create
    if (redirectingToCreateAfterWelcome) {
        return;
    }

    // Mostrar Dashboard visão geral primeiro; tela de rotinas fica oculta (classe hidden no HTML)
    if (dashboardOverview && rotinasView) {
        dashboardOverview.classList.remove('hidden');
        rotinasView.classList.add('hidden');
        document.body.classList.add('dashboard-overview-visible');
    }
    // Garantir que o overview seja renderizado após carregar dados
    try {
        if (typeof renderDashboardOverview === 'function') renderDashboardOverview();
    } catch (err) {
        console.error('renderDashboardOverview:', err);
    }

    // Botão "Dashboard" já anexado no início do script

    // Iniciar verificação de horários para notificações
    startTimeChecker();

    // Fallback: reaplicar posição dos heatmaps quando a janela terminar de carregar (layout estabilizado)
    const onLoadReapply = () => {
        setTimeout(reapplyAllHeatmapPositions, 200);
    };
    if (document.readyState === 'complete') {
        onLoadReapply();
    } else {
        window.addEventListener('load', onLoadReapply);
    }
});

// Configurar controles de visualização e filtros
function setupControls() {
    const cardsViewBtn = document.getElementById('cardsViewBtn');
    const calendarViewBtn = document.getElementById('calendarViewBtn');
    const agendaViewBtn = document.getElementById('agendaViewBtn');
    const dashboardLayout = document.querySelector('.dashboard-layout');
    const routinesGrid = document.getElementById('routinesGrid');
    const calendarView = document.getElementById('calendarView');
    const agendaView = document.getElementById('agendaView');

    if (cardsViewBtn) {
    cardsViewBtn.addEventListener('click', () => {
            if (cardsViewBtn) cardsViewBtn.classList.add('active');
            if (calendarViewBtn) calendarViewBtn.classList.remove('active');
        if (agendaViewBtn) agendaViewBtn.classList.remove('active');
        if (dashboardLayout) dashboardLayout.classList.remove('hidden');
            if (routinesGrid) routinesGrid.classList.remove('hidden');
            if (calendarView) calendarView.classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
    });
    }

    if (calendarViewBtn) {
    calendarViewBtn.addEventListener('click', () => {
            if (calendarViewBtn) calendarViewBtn.classList.add('active');
            if (cardsViewBtn) cardsViewBtn.classList.remove('active');
        if (agendaViewBtn) agendaViewBtn.classList.remove('active');
        if (dashboardLayout) dashboardLayout.classList.add('hidden');
            if (routinesGrid) routinesGrid.classList.add('hidden');
            if (calendarView) calendarView.classList.remove('hidden');
        if (agendaView) agendaView.classList.add('hidden');
            if (typeof renderCalendar === 'function') renderCalendar();
    });
    }

    if (agendaViewBtn) {
        agendaViewBtn.addEventListener('click', () => {
            agendaViewBtn.classList.add('active');
            if (cardsViewBtn) cardsViewBtn.classList.remove('active');
            if (calendarViewBtn) calendarViewBtn.classList.remove('active');
            if (dashboardLayout) dashboardLayout.classList.add('hidden');
            if (routinesGrid) routinesGrid.classList.add('hidden');
            if (calendarView) calendarView.classList.add('hidden');
            if (agendaView) agendaView.classList.remove('hidden');
            if (typeof renderAgenda === 'function') renderAgenda();
        });
    }

    const filterBtns = document.querySelectorAll('#rotinasView .filter-btn[data-filter]');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (typeof applyVerTodasFilters === 'function') applyVerTodasFilters(btn.dataset.filter);
            setTimeout(function() { if (typeof reapplyAllHeatmapPositions === 'function') reapplyAllHeatmapPositions(); }, 300);
        });
    });

    const viewFilterType = document.getElementById('viewFilterType');
    const viewFilterStatus = document.getElementById('viewFilterStatus');
    const viewFilterCategory = document.getElementById('viewFilterCategory');
    const viewFilterContext = document.getElementById('viewFilterContext');
    [viewFilterType, viewFilterStatus, viewFilterCategory, viewFilterContext].forEach(el => {
        if (el) el.addEventListener('change', () => { if (typeof applyVerTodasFilters === 'function') applyVerTodasFilters(); setTimeout(function() { if (typeof reapplyAllHeatmapPositions === 'function') reapplyAllHeatmapPositions(); }, 300); });
    });
}

function focusFirstRotinasControl() {
    requestAnimationFrame(function() {
        var el = document.getElementById('btnVoltarDashboard');
        if (el && typeof el.focus === 'function') {
            try {
                el.focus({ preventScroll: true });
            } catch (e) {
                el.focus();
            }
        }
        var lucideLib = typeof lucide !== 'undefined' ? lucide : (typeof Lucide !== 'undefined' ? Lucide : null);
        if (lucideLib && lucideLib.createIcons) lucideLib.createIcons();
    });
}

/** Estado do botão Ver cards alinhado ao progresso do dia (classes só para estilo do botão). */
function applyVerCardsButtonDayState() {
    var btn = document.getElementById('btnVerRotinas');
    if (!btn || typeof allRoutines === 'undefined' || typeof isRoutineDate !== 'function' || typeof getRoutineCompletedDates !== 'function') return;
    var todayStr = getLocalDateStr(new Date());
    var routinesToday = allRoutines.filter(function(r) { return isRoutineDate(todayStr, r); });
    var completedCount = 0;
    routinesToday.forEach(function(r) {
        if (getRoutineCompletedDates(r).has(todayStr)) completedCount++;
    });
    var total = routinesToday.length;
    var state = 'neutral';
    if (total > 0) {
        state = completedCount >= total ? 'complete' : 'pending';
    }
    btn.classList.remove('btn-ver-cards--complete', 'btn-ver-cards--pending', 'btn-ver-cards--neutral');
    btn.classList.add('btn-ver-cards--' + state);
}

function showDashboardOverview() {
    const dashboardOverview = document.getElementById('dashboardOverview');
    const rotinasView = document.getElementById('rotinasView');
    if (!dashboardOverview || !rotinasView) return;

    function runSwitch() {
        rotinasView.classList.remove('rotinas-view-enter-active', 'dashboard-view-fade-in');
        rotinasView.classList.add('hidden');
        dashboardOverview.classList.remove('hidden');
        document.body.classList.add('dashboard-overview-visible');
        renderDashboardOverview();
    }

    function afterOverviewVisible(useCssEnter) {
        if (useCssEnter) {
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    dashboardOverview.classList.add('dashboard-overview-enter-active');
                    dashboardOverview.addEventListener('animationend', function onEnd() {
                        dashboardOverview.classList.remove('dashboard-overview-enter-active');
                        dashboardOverview.removeEventListener('animationend', onEnd);
                    }, { once: true });
                });
            });
        }
    }

    if (typeof document.startViewTransition === 'function') {
        try {
            var transition = document.startViewTransition(runSwitch);
            if (transition && transition.finished && typeof transition.finished.then === 'function') {
                transition.finished.then(function() { afterOverviewVisible(false); });
            } else {
                afterOverviewVisible(false);
            }
            return;
        } catch (e) { /* fallback abaixo */ }
    }
    runSwitch();
    afterOverviewVisible(true);
}

function showRotinasView() {
    const dashboardOverview = document.getElementById('dashboardOverview');
    const rotinasView = document.getElementById('rotinasView');
    const cardsViewBtn = document.getElementById('cardsViewBtn');
    const calendarViewBtn = document.getElementById('calendarViewBtn');
    const agendaViewBtn = document.getElementById('agendaViewBtn');
    const dashboardLayout = document.querySelector('.dashboard-layout');
    const routinesGrid = document.getElementById('routinesGrid');
    const calendarView = document.getElementById('calendarView');
    const agendaView = document.getElementById('agendaView');
    if (!dashboardOverview || !rotinasView) return;

    function runSwitch() {
        dashboardOverview.classList.remove('dashboard-overview-enter-active');
        dashboardOverview.classList.add('hidden');
        rotinasView.classList.remove('hidden');
        document.body.classList.remove('dashboard-overview-visible');
        if (cardsViewBtn) cardsViewBtn.classList.add('active');
        if (calendarViewBtn) calendarViewBtn.classList.remove('active');
        if (agendaViewBtn) agendaViewBtn.classList.remove('active');
        if (dashboardLayout) dashboardLayout.classList.remove('hidden');
        if (routinesGrid) routinesGrid.classList.remove('hidden');
        if (calendarView) calendarView.classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        setTimeout(reapplyAllHeatmapPositions, 200);
    }

    function afterRotinasVisible(useCssEnter) {
        if (useCssEnter) {
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    rotinasView.classList.add('rotinas-view-enter-active');
                    rotinasView.addEventListener('animationend', function onEnd() {
                        rotinasView.classList.remove('rotinas-view-enter-active');
                        rotinasView.removeEventListener('animationend', onEnd);
                    }, { once: true });
                });
            });
        }
        focusFirstRotinasControl();
    }

    if (typeof document.startViewTransition === 'function') {
        try {
            var transition2 = document.startViewTransition(runSwitch);
            if (transition2 && transition2.finished && typeof transition2.finished.then === 'function') {
                transition2.finished.then(function() { afterRotinasVisible(false); });
            } else {
                afterRotinasVisible(false);
            }
            return;
        } catch (e) { /* fallback abaixo */ }
    }
    runSwitch();
    afterRotinasVisible(true);
}

window.showRotinasView = showRotinasView;
window.showDashboardOverview = showDashboardOverview;

function switchRotinasView(view) {
    if (view === 'dashboard') {
        showDashboardOverview();
        return;
    }
    const rotinasView = document.getElementById('rotinasView');
    const cardsViewBtn = document.getElementById('cardsViewBtn');
    const calendarViewBtn = document.getElementById('calendarViewBtn');
    const agendaViewBtn = document.getElementById('agendaViewBtn');
    const bibliotecaViewBtn = document.getElementById('bibliotecaViewBtn');
    const dashboardLayout = document.querySelector('.dashboard-layout');
    const routinesGrid = document.getElementById('routinesGrid');
    const calendarView = document.getElementById('calendarView');
    const agendaView = document.getElementById('agendaView');
    const bibliotecaView = document.getElementById('bibliotecaView');
    if (!rotinasView) return;
    /* Evita main-content com overflow:hidden da vista overview (cartões cortados no telemóvel) */
    document.body.classList.remove('dashboard-overview-visible');
    rotinasView.querySelectorAll('.view-btn[data-view]').forEach(function(b) { b.classList.remove('active'); });
    var filtersEl = rotinasView ? rotinasView.querySelector('.dashboard-controls .filters') : null;
    if (view === 'cards') {
        if (cardsViewBtn) cardsViewBtn.classList.add('active');
        if (dashboardLayout) dashboardLayout.classList.remove('hidden');
        if (routinesGrid) routinesGrid.classList.remove('hidden');
        if (calendarView) calendarView.classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (bibliotecaView) bibliotecaView.classList.add('hidden');
        if (filtersEl) filtersEl.classList.remove('hidden');
    } else if (view === 'calendar') {
        if (calendarViewBtn) calendarViewBtn.classList.add('active');
        if (dashboardLayout) dashboardLayout.classList.add('hidden');
        if (routinesGrid) routinesGrid.classList.add('hidden');
        if (calendarView) calendarView.classList.remove('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (bibliotecaView) bibliotecaView.classList.add('hidden');
        if (typeof renderCalendar === 'function') renderCalendar();
        if (filtersEl) filtersEl.classList.add('hidden');
    } else if (view === 'agenda') {
        if (agendaViewBtn) agendaViewBtn.classList.add('active');
        if (dashboardLayout) dashboardLayout.classList.add('hidden');
        if (routinesGrid) routinesGrid.classList.add('hidden');
        if (calendarView) calendarView.classList.add('hidden');
        if (agendaView) agendaView.classList.remove('hidden');
        if (bibliotecaView) bibliotecaView.classList.add('hidden');
        if (typeof renderAgenda === 'function') renderAgenda();
        if (filtersEl) filtersEl.classList.add('hidden');
    } else if (view === 'biblioteca') {
        if (bibliotecaViewBtn) bibliotecaViewBtn.classList.add('active');
        if (dashboardLayout) dashboardLayout.classList.add('hidden');
        if (routinesGrid) routinesGrid.classList.add('hidden');
        if (calendarView) calendarView.classList.add('hidden');
        if (agendaView) agendaView.classList.add('hidden');
        if (bibliotecaView) bibliotecaView.classList.remove('hidden');
        if (typeof renderBiblioteca === 'function') renderBiblioteca();
        if (filtersEl) filtersEl.classList.add('hidden');
    }
}
window.switchRotinasView = switchRotinasView;

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function formatLastUpdate(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    var day = d.getDate();
    var month = (MONTH_NAMES[d.getMonth()] || '').slice(0, 3);
    var year = d.getFullYear();
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    var s = String(d.getSeconds()).padStart(2, '0');
    return day + ' ' + month + ' ' + year + ', ' + h + ':' + m + ':' + s;
}
function formatAnnotationTime(isoStr) {
    if (!isoStr) return '—';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return '—';
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    var s = String(d.getSeconds()).padStart(2, '0');
    return h + ':' + m + ':' + s;
}

function renderDaySummary(routinesToday, completedCount) {
    const el = document.getElementById('dashboardDaySummary');
    if (!el) return;
    const now = new Date();
    const day = now.getDate();
    const month = MONTH_NAMES[now.getMonth()];
    const total = routinesToday.length;
    const dateText = `${day} de ${month}`;
    const parts = [];
    parts.push(`<span class="dashboard-day-summary-stat"><i data-lucide="check-circle" class="dashboard-day-summary-icon dashboard-day-summary-icon--done" aria-hidden="true"></i>${completedCount}/${total} tarefas</span>`);
    el.innerHTML = `<span class="dashboard-day-summary-date">${escapeHtml(dateText)}</span><span class="dashboard-day-summary-stats">${parts.join('<span class="dashboard-day-summary-sep">·</span>')}</span>`;
    const lucideLib = typeof lucide !== 'undefined' ? lucide : (typeof Lucide !== 'undefined' ? Lucide : null);
    if (lucideLib && lucideLib.createIcons) lucideLib.createIcons();
}

function updateDashboardLastUpdate() {
    const el = document.getElementById('dashboardLastUpdate');
    if (!el) return;
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    el.textContent = 'Última atualização: ' + day + '/' + month + '/' + year + ', ' + h + ':' + m;
}

function renderDashboardOverview() {
    const todayStr = getLocalDateStr(new Date());
    const now = new Date();
    const currentTimeMin = now.getHours() * 60 + now.getMinutes();

    const routinesToday = allRoutines.filter(r => isRoutineDate(todayStr, r));
    const completedTodaySet = new Set(routinesToday.filter(r => getRoutineCompletedDates(r).has(todayStr)).map(r => r.id));
    const completedCount = completedTodaySet.size;

    renderDaySummary(routinesToday, completedCount);
    updateDashboardLastUpdate();

    // Ordenar por horário (sem horário vai por último)
    const sortedToday = routinesToday.slice().sort((a, b) => {
        const ta = a.schedule?.time || '99:99';
        const tb = b.schedule?.time || '99:99';
        return ta.localeCompare(tb);
    });
    const hiddenOverviewTitles = new Set(['calibrar', 'academia']);
    const mainRoutine = sortedToday.find((r) => {
        const title = String(r && r.title ? r.title : '').trim().toLowerCase();
        return !hiddenOverviewTitles.has(title);
    }) || null;

    function statusForRoutine(r) {
        if (completedTodaySet.has(r.id)) return { status: 'done', label: 'Concluída' };
        const t = r.schedule?.time;
        if (t) {
            const [h, m] = t.split(':').map(Number);
            const routineMin = h * 60 + m;
            if (currentTimeMin >= routineMin - 15 && currentTimeMin <= routineMin + 60) return { status: 'progress', label: 'Em andamento' };
        }
        return { status: 'pending', label: 'Pendente' };
    }

    // Bloco 1 – Rotina de Hoje (card principal)
    const todayEl = document.getElementById('dashboardTodayContent');
    if (todayEl) {
        if (!mainRoutine) {
            todayEl.innerHTML = '<p class="dashboard-today-empty">Nenhuma rotina hoje</p><p class="dashboard-today-empty-hint">Aproveite o dia.</p>';
            todayEl.closest('.dashboard-card').className = 'dashboard-card dashboard-card--main dashboard-card--empty';
        } else {
            const status = statusForRoutine(mainRoutine);
            const timeLabel = mainRoutine.schedule?.time ? mainRoutine.schedule.time : 'Sem horário fixo';
            todayEl.closest('.dashboard-card').className = 'dashboard-card dashboard-card--main dashboard-card--status-' + status.status;
            todayEl.innerHTML = `
                <a href="routine-detail.html?id=${encodeURIComponent(mainRoutine.id)}" class="dashboard-today-link">
                    <span class="dashboard-today-name">${escapeHtml(mainRoutine.title || 'Rotina')}</span>
                    <span class="dashboard-today-time">${escapeHtml(timeLabel)}</span>
                    <span class="dashboard-today-badge status-${status.status}" aria-label="${escapeHtml(status.label)}">${escapeHtml(status.label)}</span>
                </a>`;
        }
    }

    // Bloco 2 – Progresso do dia (UI B/W; classes complete/pending/neutral para trilho/texto neutro)
    const progressEl = document.getElementById('dashboardProgressContent');
    const progressSection = document.getElementById('dashboardProgress');
    if (progressEl) {
        const total = routinesToday.length;
        const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
        var dayProgressState = 'neutral';
        if (total > 0) {
            dayProgressState = pct >= 100 ? 'complete' : 'pending';
        }
        if (progressSection) {
            progressSection.className = 'dashboard-card dashboard-card--progress dashboard-card--progress--' + dayProgressState;
        }
        progressEl.innerHTML = `
            <p class="dashboard-progress-text">${completedCount} de ${total} concluídas</p>
            <div class="dashboard-progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
                <div class="dashboard-progress-fill chart-animate-width" data-width="${pct}" style="width:0%"></div>
            </div>`;
    }

    // Bloco Pendentes – contador grande e direto
    const pendingEl = document.getElementById('dashboardPendingTasksContent');
    if (pendingEl) {
        const pendingCount = Math.max(0, routinesToday.length - completedCount);
        pendingEl.innerHTML = `
            <h2 class="dashboard-pending-tasks-title">TAREFAS PENDENTES</h2>
            <p class="dashboard-pending-tasks-value">${pendingCount}</p>`;
    }

    // Bloco Próximas – hoje com horário (ex: "Reunião 14h") + próximos 7 dias
    const nextEl = document.getElementById('dashboardNextContent');
    if (nextEl) {
        const dayLabels = { 0: 'dom.', 1: 'seg.', 2: 'ter.', 3: 'qua.', 4: 'qui.', 5: 'sex.', 6: 'sáb.' };
        const todayWithTime = routinesToday
            .filter(r => r.schedule?.time)
            .slice().sort((a, b) => (a.schedule.time || '').localeCompare(b.schedule.time || ''))
            .map(r => {
                const t = r.schedule.time;
                const hour = t ? t.replace(/^(\d{1,2}):\d{2}$/, '$1h') : '';
                return { title: r.title || 'Rotina', id: r.id, timeLabel: hour, isToday: true };
            });
        const itemsNext = [];
        for (let i = 1; i <= 7; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() + i);
            const dateStr = getLocalDateStr(d);
            const dayLabel = i === 1 ? 'Amanhã' : dayLabels[d.getDay()] + ' ' + d.getDate();
            const routinesOnDay = allRoutines.filter(r => isRoutineDate(dateStr, r));
            routinesOnDay.forEach(r => {
                itemsNext.push({ title: r.title || 'Rotina', id: r.id, dayLabel: dayLabel });
            });
        }
        let html = '';
        if (todayWithTime.length > 0) {
            html += '<ul class="dashboard-next-list dashboard-next-list--today" aria-label="Hoje">';
            html += todayWithTime.map(it =>
                `<li><a href="routine-detail.html?id=${encodeURIComponent(it.id)}" class="dashboard-next-link">${escapeHtml(it.title)} <span class="dashboard-next-time">${escapeHtml(it.timeLabel)}</span></a></li>`
            ).join('');
            html += '</ul>';
        }
        if (itemsNext.length > 0) {
            if (html) html += '<p class="dashboard-next-subtitle">Próximos dias</p>';
            html += '<ul class="dashboard-next-list">' + itemsNext.slice(0, 8).map(it =>
                `<li><a href="routine-detail.html?id=${encodeURIComponent(it.id)}" class="dashboard-next-link">${escapeHtml(it.title)} <span class="dashboard-next-day">${escapeHtml(it.dayLabel)}</span></a></li>`
            ).join('') + '</ul>';
        }
        if (!html) {
            nextEl.innerHTML = '<p class="dashboard-next-empty">Nada agendado hoje nem nos próximos dias.</p>';
        } else {
            nextEl.innerHTML = html;
        }
    }

    // Gráfico de produtividade
    renderFrequencyChart();
    renderStatsCharts(routinesToday, completedCount);

    // Animar barras (width/height de 0 para valor final)
    requestAnimationFrame(() => {
        const overview = document.getElementById('dashboardOverview');
        if (!overview) return;
        overview.querySelectorAll('.chart-animate-width').forEach(bar => {
            const w = bar.getAttribute('data-width');
            if (w != null) bar.style.width = w + '%';
        });
        overview.querySelectorAll('.chart-animate-height').forEach(bar => {
            const h = bar.getAttribute('data-height');
            if (h != null) bar.style.height = h + '%';
        });
    });

    try {
        if (typeof applyVerCardsButtonDayState === 'function') applyVerCardsButtonDayState();
    } catch (e) { /* noop */ }
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

        // Verificar se a resposta é JSON
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
            throw new Error('Não foi possível conectar ao servidor. Certifique-se de que o servidor está rodando (npm start)');
        }
        
        throw error;
    }
}

// Carregar rotinas
let allRoutines = [];

// Offset do heatmap por rotina: quantos meses a partir de hoje (0 = mês atual, positivo = meses anteriores)
const heatmapOffsets = {};

/**
 * Mescla checkIns e task.completedDates do localStorage nas rotinas vindas da API.
 * Sem isto, conclusões gravadas localmente (ou PUT ainda não refletido no GET) somem do dashboard.
 */
function mergeRoutineProgressFromLocal(serverRoutines) {
    if (!Array.isArray(serverRoutines) || serverRoutines.length === 0) return;
    try {
        var local = JSON.parse(localStorage.getItem('localRoutines') || '[]');
        if (!Array.isArray(local) || local.length === 0) return;
        serverRoutines.forEach(function (routine) {
            var loc = local.find(function (r) { return String(r.id) === String(routine.id); });
            if (!loc) return;
            var dset = new Set();
            (routine.checkIns || []).forEach(function (x) {
                var n = normalizeDateStr(x);
                if (n) dset.add(n);
            });
            (loc.checkIns || []).forEach(function (x) {
                var n = normalizeDateStr(x);
                if (n) dset.add(n);
            });
            routine.checkIns = Array.from(dset).sort();
            if (!routine.tasks || !loc.tasks) return;
            routine.tasks.forEach(function (task) {
                var lt = loc.tasks.find(function (t) { return String(t.id) === String(task.id); });
                if (!lt) return;
                var cset = new Set();
                (task.completedDates || []).forEach(function (x) {
                    var n = normalizeDateStr(x);
                    if (n) cset.add(n);
                });
                (lt.completedDates || []).forEach(function (x) {
                    var n = normalizeDateStr(x);
                    if (n) cset.add(n);
                });
                task.completedDates = Array.from(cset).sort();
                if (lt.completed === true) task.completed = true;
            });
        });
    } catch (e) { /* noop */ }
}

async function loadRoutines(filter = 'all') {
    const token = localStorage.getItem('token');
    
    if (token) {
        try {
            allRoutines = await apiRequest('/routines');
            // Mesclar annotationsByDate do localStorage (backup) para não perder anotações ao atualizar
            try {
                const local = JSON.parse(localStorage.getItem('localRoutines') || '[]');
                if (Array.isArray(local) && local.length > 0) {
                    allRoutines.forEach(function (routine) {
                        const localRoutine = local.find(function (r) { return r.id === routine.id; });
                        if (!localRoutine || !routine.tasks) return;
                        (routine.tasks || []).forEach(function (task) {
                            const localTask = (localRoutine.tasks || []).find(function (t) { return t.id === task.id; });
                            if (!localTask || !localTask.annotationsByDate || typeof localTask.annotationsByDate !== 'object') return;
                            const existing = task.annotationsByDate && typeof task.annotationsByDate === 'object' ? task.annotationsByDate : {};
                            task.annotationsByDate = { ...localTask.annotationsByDate, ...existing };
                        });
                    });
                }
            } catch (_) {}
            mergeRoutineProgressFromLocal(allRoutines);
            // Calcular progresso para cada rotina
            allRoutines = allRoutines.map(routine => ({
                ...routine,
                checkIns: routine.checkIns || [], // Garantir que checkIns existe
                progress: calculateProgress(routine)
            }));
        } catch (error) {
            console.log('Servidor não disponível, carregando rotinas locais');
            try {
            allRoutines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
                if (!Array.isArray(allRoutines)) allRoutines = [];
            } catch (e) {
                allRoutines = [];
            }
            allRoutines = allRoutines.map(routine => ({
                ...routine,
                checkIns: routine.checkIns || [],
                progress: calculateProgress(routine)
            }));
        }
    } else {
        // Modo offline: carregar do localStorage
        try {
        allRoutines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
            if (!Array.isArray(allRoutines)) allRoutines = [];
        } catch (e) {
            allRoutines = [];
        }
        allRoutines = allRoutines.map(routine => ({
            ...routine,
            checkIns: routine.checkIns || [], // Garantir que checkIns existe
            progress: calculateProgress(routine)
        }));
    }

    // Aplicar filtros da view "Ver todas" (botões + dropdowns)
    applyVerTodasFilters(filter);

    // Atualizar visão geral / gráficos sempre que estivermos no dashboard (mesmo com overview oculto)
    if (document.getElementById('dashboardProgressContent') && typeof renderDashboardOverview === 'function') {
        renderDashboardOverview();
    }

    const calendarView = document.getElementById('calendarView');
    if (calendarView && !calendarView.classList.contains('hidden') && typeof renderCalendar === 'function') {
        renderCalendar();
    }

    // Reaplicar posição dos heatmaps (layout pode demorar)
    setTimeout(reapplyAllHeatmapPositions, 300);
}

// Aplica filtros da view "Ver todas" (Todas/Sequências + Tipo, Status, Categoria) e renderiza
function applyVerTodasFilters(initialViewFilter) {
    const viewFilterBtn = document.querySelector('#rotinasView .filter-btn.active');
    const viewFilter = initialViewFilter !== undefined ? initialViewFilter : (viewFilterBtn?.dataset.filter || 'all');
    const typeEl = document.getElementById('viewFilterType');
    const statusEl = document.getElementById('viewFilterStatus');
    const categoryEl = document.getElementById('viewFilterCategory');
    const contextEl = document.getElementById('viewFilterContext');

    let filtered = allRoutines.slice();
    if (viewFilter === 'sequences') filtered = filtered.filter(r => getCurrentStreak(r) > 0);

    const typeVal = typeEl ? typeEl.value : '';
    const statusVal = statusEl ? statusEl.value : '';
    let categoryVal = categoryEl ? categoryEl.value : '';
    let contextVal = contextEl ? contextEl.value : '';

    if (categoryEl && categoryEl.options.length <= 1) {
        const names = [...new Set(allRoutines.map(r => r.category?.name).filter(Boolean))].sort();
        categoryEl.innerHTML = '<option value="">Todas</option>' + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
        categoryVal = categoryEl.value;
    }
    if (contextEl && contextEl.options.length <= 1) {
        const ctxs = [...new Set(allRoutines.map(r => (r.context || '').trim()).filter(Boolean))].sort();
        contextEl.innerHTML = '<option value="">Todos</option>' + ctxs.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        contextVal = contextEl.value;
    }

    const todayStr = getLocalDateStr(new Date());
    if (typeVal) filtered = filtered.filter(r => (r.bulletType || 'task') === typeVal);
    if (statusVal === 'done') filtered = filtered.filter(r => getRoutineCompletedDates(r).has(todayStr));
    if (statusVal === 'pending') filtered = filtered.filter(r => isRoutineDate(todayStr, r) && !getRoutineCompletedDates(r).has(todayStr));
    if (statusVal === 'overdue') filtered = filtered.filter(r => isRoutineOverdue(r));
    if (categoryVal) filtered = filtered.filter(r => (r.category?.name || '') === categoryVal);
    if (contextVal) filtered = filtered.filter(r => (r.context || '').trim() === contextVal);

    renderRoutines(filtered);
}

// Calcular progresso de uma rotina (sem tarefas: 100% se check-in hoje — alinhado ao detalhe da rotina)
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

// Renderizar rotinas como cards
function renderRoutines(routines) {
    const routinesGrid = document.getElementById('routinesGrid');
    const emptyState = document.getElementById('emptyState');

    if (routines.length === 0) {
        routinesGrid.innerHTML = createAddRoutineCard();
        emptyState.classList.add('visible');
        return;
    }

    emptyState.classList.remove('visible');
    // Renderizar cards de rotinas + card de adicionar no final
    routinesGrid.innerHTML = routines.map(routine => createRoutineCard(routine)).join('') + createAddRoutineCard();
    const lucideLib = typeof lucide !== 'undefined' ? lucide : (typeof Lucide !== 'undefined' ? Lucide : null);
    if (lucideLib && lucideLib.createIcons) {
        lucideLib.createIcons();
    }
    
    // Adicionar event listeners aos cards
    routines.forEach(routine => {
        const card = document.querySelector(`[data-routine-id="${routine.id}"]`);
        if (card) {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.routine-card-actions')) {
                    window.location.href = `routine-detail.html?id=${routine.id}`;
                }
            });
        }

        // Botão de editar
        const editBtn = document.querySelector(`[data-edit-id="${routine.id}"]`);
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.href = `create.html?edit=${routine.id}`;
            });
        }

        // Botão de deletar
        const deleteBtn = document.querySelector(`[data-delete-id="${routine.id}"]`);
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteRoutine(routine.id);
            });
        }

        attachHeatmapListeners(card, routine);
    });
}

// Obter dados de frequência dos últimos 30 dias
function getFrequencyData(routine) {
    const checkIns = routine.checkIns || [];
    const today = new Date();
    const frequencyData = [];
    
    // Criar array dos últimos 30 dias
    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const isChecked = checkIns.includes(dateStr);
        frequencyData.push({
            date: dateStr,
            checked: isChecked
        });
    }
    
    return frequencyData;
}

// Verifica se o dia da semana (0-6) faz parte dos dias da rotina
function isRoutineWeekday(dateStr, routine) {
    if (!routine || !routine.schedule) return true;
    const weekDays = routine.schedule.weekDays;
    const planType = routine.planType || 'daily';
    if (!weekDays || !Array.isArray(weekDays)) return true; // diário "todos os dias" = todos são dias da rotina
    const d = new Date(dateStr + 'T12:00:00');
    const dayOfWeek = d.getDay();
    return weekDays.indexOf(dayOfWeek) !== -1;
}

// Verifica se a data é dia de rotina (considera daily, weekly e monthly)
function isRoutineDate(dateStr, routine) {
    if (!routine || !routine.schedule) return false;
    const d = new Date(dateStr + 'T12:00:00');
    const planType = routine.planType || 'daily';
    const s = routine.schedule;
    if (planType === 'monthly' && s.monthlyType === 'dayOfMonth' && s.dayOfMonth != null) {
        return d.getDate() === Number(s.dayOfMonth);
    }
    if (planType === 'monthly' && s.monthlyType === 'weekOfMonth' && (s.weekOfMonth != null || s.dayOfWeek != null)) {
        const dayOfWeek = d.getDay();
        const weekOfMonth = s.weekOfMonth === 'last' ? 5 : parseInt(s.weekOfMonth, 10);
        const targetDow = s.dayOfWeek != null ? Number(s.dayOfWeek) : dayOfWeek;
        if (dayOfWeek !== targetDow) return false;
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        if (s.weekOfMonth === 'last') {
            let lastMatch = null;
            for (let day = lastDay.getDate(); day >= 1; day--) {
                const dt = new Date(d.getFullYear(), d.getMonth(), day);
                if (dt.getDay() === targetDow) {
                    lastMatch = day;
                    break;
                }
            }
            return lastMatch !== null && d.getDate() === lastMatch;
        }
        let n = 0;
        for (let day = 1; day <= d.getDate(); day++) {
            const dt = new Date(d.getFullYear(), d.getMonth(), day);
            if (dt.getDay() === targetDow) n++;
        }
        return n === weekOfMonth;
    }
    return isRoutineWeekday(dateStr, routine);
}

// Conta rotinas com pelo menos um dia atrasado nos últimos 7 dias
function getOverdueCount() {
    const now = new Date();
    const todayStr = getLocalDateStr(now);
    const overdueRoutineIds = new Set();
    for (let i = 1; i <= 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = getLocalDateStr(d);
        allRoutines.forEach(r => {
            if (isRoutineDate(dateStr, r) && !getRoutineCompletedDates(r).has(dateStr)) {
                overdueRoutineIds.add(r.id);
            }
        });
    }
    return overdueRoutineIds.size;
}

function isRoutineOverdue(routine) {
    const now = new Date();
    const todayStr = getLocalDateStr(now);
    for (let i = 1; i <= 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = getLocalDateStr(d);
        if (isRoutineDate(dateStr, routine) && !getRoutineCompletedDates(routine).has(dateStr)) return true;
    }
    return false;
}

// Dados de frequência global: últimos 30 dias, quantas rotinas concluídas por dia
function getGlobalFrequencyData() {
    const now = new Date();
    const result = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = getLocalDateStr(d);
        let count = 0;
        allRoutines.forEach(r => {
            if (getRoutineCompletedDates(r).has(dateStr)) count++;
        });
        result.push({ dateStr, count });
    }
    return result;
}

// Lista detalhada: popula select de categorias e renderiza tabela
const BULLET_TYPE_LABELS = { reminder: 'Lembrete', task: 'Tarefa', commitment: 'Compromisso', important: 'Importante' };

function getNextOccurrenceLabel(routine) {
    const now = new Date();
    const todayStr = getLocalDateStr(now);
    const dayLabels = { 0: 'dom.', 1: 'seg.', 2: 'ter.', 3: 'qua.', 4: 'qui.', 5: 'sex.', 6: 'sáb.' };
    if (isRoutineDate(todayStr, routine) && routine.schedule?.time) {
        const t = routine.schedule.time;
        const hour = t ? t.replace(/^(\d{1,2}):\d{2}$/, '$1h') : '';
        return 'Hoje ' + hour;
    }
    for (let i = 1; i <= 14; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        const dateStr = getLocalDateStr(d);
        if (isRoutineDate(dateStr, routine)) {
            return i === 1 ? 'Amanhã' : dayLabels[d.getDay()] + ' ' + d.getDate();
        }
    }
    return '—';
}

function renderDetailList(routinesToday, completedTodaySet, statusForRoutine) {
    const todayStr = getLocalDateStr(new Date());
    const typeSelect = document.getElementById('detailFilterType');
    const statusSelect = document.getElementById('detailFilterStatus');
    const categorySelect = document.getElementById('detailFilterCategory');
    const contextSelect = document.getElementById('detailFilterContext');
    const tbody = document.getElementById('dashboardDetailTableBody');
    const tableWrap = document.getElementById('dashboardDetailTableWrap');
    const emptyEl = document.getElementById('dashboardDetailEmpty');
    if (!tbody || !tableWrap) return;

    const typeVal = typeSelect ? typeSelect.value : '';
    const statusVal = statusSelect ? statusSelect.value : '';
    const categoryVal = categorySelect ? categorySelect.value : '';
    const contextVal = contextSelect ? contextSelect.value : '';

    let filtered = allRoutines.slice();
    if (typeVal) filtered = filtered.filter(r => (r.bulletType || 'task') === typeVal);
    if (statusVal === 'done') filtered = filtered.filter(r => getRoutineCompletedDates(r).has(todayStr));
    if (statusVal === 'pending') filtered = filtered.filter(r => isRoutineDate(todayStr, r) && !getRoutineCompletedDates(r).has(todayStr));
    if (statusVal === 'overdue') filtered = filtered.filter(r => isRoutineOverdue(r));
    if (categoryVal) filtered = filtered.filter(r => (r.category?.name || '') === categoryVal);
    if (contextVal) filtered = filtered.filter(r => (r.context || '').trim() === contextVal);

    if (categorySelect) {
        const names = [...new Set(allRoutines.map(r => r.category?.name).filter(Boolean))].sort();
        categorySelect.innerHTML = '<option value="">Todas</option>' + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
        if (categoryVal) categorySelect.value = categoryVal;
    }
    if (contextSelect) {
        const ctxs = [...new Set(allRoutines.map(r => (r.context || '').trim()).filter(Boolean))].sort();
        contextSelect.innerHTML = '<option value="">Todos</option>' + ctxs.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        if (contextVal) contextSelect.value = contextVal;
    }

    function statusToday(r) {
        if (!isRoutineDate(todayStr, r)) return '—';
        if (getRoutineCompletedDates(r).has(todayStr)) return 'Concluída';
        if (isRoutineOverdue(r)) return 'Atrasada';
        return 'Pendente';
    }

    tbody.innerHTML = filtered.map(r => {
        const status = statusToday(r);
        const typeLabel = BULLET_TYPE_LABELS[r.bulletType] || 'Tarefa';
        const catName = r.category?.name || '—';
        const nextLabel = getNextOccurrenceLabel(r);
        const statusClass = status === 'Concluída' ? 'detail-status-done' : status === 'Atrasada' ? 'detail-status-overdue' : 'detail-status-pending';
        return `<tr class="dashboard-detail-row">
          <td><a href="routine-detail.html?id=${encodeURIComponent(r.id)}" class="dashboard-detail-link">${escapeHtml(r.title || 'Rotina')}</a></td>
          <td>${escapeHtml(typeLabel)}</td>
          <td>${escapeHtml(catName)}</td>
          <td><span class="dashboard-detail-status ${statusClass}">${escapeHtml(status)}</span></td>
          <td>${escapeHtml(nextLabel)}</td>
          <td><a href="routine-detail.html?id=${encodeURIComponent(r.id)}" class="dashboard-detail-action">Ver</a> <a href="create.html?edit=${encodeURIComponent(r.id)}" class="dashboard-detail-action">Editar</a></td>
        </tr>`;
    }).join('');

    if (tableWrap) tableWrap.classList.toggle('hidden', filtered.length === 0);
    if (emptyEl) emptyEl.classList.toggle('hidden', filtered.length > 0);
}

function setupDetailListFilters() {
    const typeSelect = document.getElementById('detailFilterType');
    const statusSelect = document.getElementById('detailFilterStatus');
    const categorySelect = document.getElementById('detailFilterCategory');
    const onChange = () => {
        const todayStr = getLocalDateStr(new Date());
        const now = new Date();
        const currentTimeMin = now.getHours() * 60 + now.getMinutes();
        const routinesToday = allRoutines.filter(r => isRoutineDate(todayStr, r));
        const completedTodaySet = new Set(routinesToday.filter(r => getRoutineCompletedDates(r).has(todayStr)).map(r => r.id));
        function statusForRoutine(r) {
            if (completedTodaySet.has(r.id)) return { status: 'done', label: 'Concluída' };
            const t = r.schedule?.time;
            if (t) {
                const [h, m] = t.split(':').map(Number);
                const routineMin = h * 60 + m;
                if (currentTimeMin >= routineMin - 15 && currentTimeMin <= routineMin + 60) return { status: 'progress', label: 'Em andamento' };
            }
            return { status: 'pending', label: 'Pendente' };
        }
        renderDetailList(routinesToday, completedTodaySet, statusForRoutine);
    };
    if (typeSelect) typeSelect.addEventListener('change', onChange);
    if (statusSelect) statusSelect.addEventListener('change', onChange);
    if (categorySelect) categorySelect.addEventListener('change', onChange);
    const contextSelect = document.getElementById('detailFilterContext');
    if (contextSelect) contextSelect.addEventListener('change', onChange);
}

// Renderiza gráfico de produtividade (linhas acumuladas estilo mercado) – 7d/30d
function renderFrequencyChart() {
    const el = document.getElementById('dashboardFrequencyContent');
    if (!el) return;
    const now = new Date();
    if (window._dashboardFrequencyPeriod !== '7d' && window._dashboardFrequencyPeriod !== '30d') {
        window._dashboardFrequencyPeriod = '7d';
    }
    const period = window._dashboardFrequencyPeriod;
    const daysCount = period === '7d' ? 7 : 30;
    const days = [];
    for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push(getLocalDateStr(d));
    }

    const series = [];
    (allRoutines || []).forEach((routine, rIdx) => {
        const tasks = Array.isArray(routine && routine.tasks) ? routine.tasks : [];
        const windowStart = days.length ? days[0] : '';

        function pushSeriesFromCompletedSet(completedDatesSet, idSuffix, displayName) {
            const completedDates = completedDatesSet instanceof Set ? completedDatesSet : new Set(completedDatesSet || []);
            let cumulative = 0;
            if (windowStart) {
                completedDates.forEach(d => {
                    if (d < windowStart) cumulative += 1;
                });
            }
            const values = days.map(d => {
                if (completedDates.has(d)) cumulative += 1;
                return cumulative;
            });
            series.push({
                id: `${routine.id || rIdx}-${idSuffix}`,
                name: displayName,
                values,
                completedDates
            });
        }

        if (tasks.length === 0) {
            /* Rotina sem subtarefas: conclusões vêm de checkIns / fluxo "tarefa completa?" */
            const agg = getRoutineCompletedDates(routine);
            if (agg.size === 0) return;
            const routineName = String(routine.title || `Rotina ${rIdx + 1}`).trim().toUpperCase();
            pushSeriesFromCompletedSet(agg, 'rotina', routineName);
            return;
        }

        tasks.forEach((task, tIdx) => {
            const taskName = String(task && task.text ? task.text : `Tarefa ${tIdx + 1}`).trim().toUpperCase();
            const completedDates = new Set();
            if (task && Array.isArray(task.completedDates)) {
                task.completedDates.forEach(d => {
                    const normalized = normalizeDateStr(d);
                    if (normalized) completedDates.add(normalized);
                });
            }
            let cumulative = 0;
            if (windowStart) {
                completedDates.forEach(d => {
                    if (d < windowStart) cumulative += 1;
                });
            }
            const values = days.map(d => {
                if (completedDates.has(d)) cumulative += 1;
                return cumulative;
            });
            series.push({
                id: `${routine.id || rIdx}-${task.id || tIdx}`,
                name: taskName,
                values,
                completedDates
            });
        });
    });

    if (!series.length) {
        el.innerHTML = '<p class="dashboard-frequency-chart-legend">Sem conclusões no período — marque rotinas ou tarefas para ver o gráfico.</p>';
        return;
    }

    const goalValue = 3;
    const maxY = Math.max(goalValue, ...series.flatMap(s => s.values), 1);

    const palette = series.map(() => '#000000');

    const w = 960;
    const h = 260;
    const pad = { left: 30, right: 14, top: 18, bottom: 44 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const x = (i) => pad.left + (i / Math.max(1, days.length - 1)) * plotW;
    const y = (v) => pad.top + plotH - (v / maxY) * plotH;

    const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxY / 4) * i));
    const labels = [];
    for (let i = 0; i < days.length; i += Math.max(1, Math.floor(days.length / 6))) {
        labels.push({ i, day: days[i].slice(8, 10) });
    }

    function toSmoothPath(points) {
        if (!points.length) return '';
        if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
        // Tensão um pouco maior para recuperar a "curvinha para baixo"
        // antes da subida final (efeito visual estilo mercado).
        const tension = 0.28;
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i - 1] || points[i];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[i + 2] || p2;
            const cp1x = p1.x + (p2.x - p0.x) * tension;
            const cp1y = p1.y + (p2.y - p0.y) * tension;
            const cp2x = p2.x - (p3.x - p1.x) * tension;
            const cp2y = p2.y - (p3.y - p1.y) * tension;
            d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
        }
        return d;
    }

    // Offset dinâmico para separar linhas sobrepostas (mesmo x/y)
    const yOffsetBySeriesPoint = {};
    const overlapGapPx = 3.2;
    for (let i = 0; i < days.length; i++) {
        const buckets = {};
        series.forEach((s, si) => {
            const v = s.values[i] || 0;
            const key = `${i}:${v}`;
            if (!buckets[key]) buckets[key] = [];
            buckets[key].push(si);
        });
        Object.keys(buckets).forEach(key => {
            const sis = buckets[key];
            if (!sis || sis.length <= 1) {
                if (sis && sis.length === 1) yOffsetBySeriesPoint[`${sis[0]}:${i}`] = 0;
                return;
            }
            // Distribuição alternada: 0, +1, -1, +2, -2...
            const ranks = [0];
            for (let n = 1; n < sis.length; n++) {
                const step = Math.ceil(n / 2);
                const sign = n % 2 === 1 ? 1 : -1;
                ranks.push(step * sign);
            }
            sis.forEach((si, idx) => {
                yOffsetBySeriesPoint[`${si}:${i}`] = ranks[idx] * overlapGapPx;
            });
        });
    }

    const seriesPaths = series.map((s, si) => {
        const points = s.values.map((v, i) => {
            const offset = yOffsetBySeriesPoint[`${si}:${i}`] || 0;
            return { x: x(i), y: y(v) + offset };
        });
        return `<path d="${toSmoothPath(points)}" class="dashboard-frequency-series-line" data-series="${si}" style="--series-color:${palette[si % palette.length]}"/>`;
    }).join('');

    const seriesDots = series.map((s, si) => {
        return s.values.map((v, i) => {
            if (i > 0 && s.values[i - 1] === v && i !== s.values.length - 1) return '';
            const offset = yOffsetBySeriesPoint[`${si}:${i}`] || 0;
            const isCompleted = s.completedDates && s.completedDates.has(days[i]);
            const dotState = isCompleted ? 'done' : 'pending';
            return `<circle cx="${x(i)}" cy="${y(v) + offset}" r="3.2" class="dashboard-frequency-series-dot" data-series="${si}" data-date="${days[i]}" data-value="${v}" data-state="${dotState}" style="--series-color:${palette[si % palette.length]}"/>`;
        }).join('');
    }).join('');

    const endLabelMinGap = 14;
    const endLabelCandidates = series.map((s, si) => {
        const xEnd = x(days.length - 1);
        const yEnd = y(s.values[s.values.length - 1] || 0);
        return {
            si,
            text: s.name,
            xEnd,
            yEnd,
            yLabel: yEnd - 10
        };
    }).sort((a, b) => a.yLabel - b.yLabel);

    for (let i = 1; i < endLabelCandidates.length; i++) {
        const prev = endLabelCandidates[i - 1];
        const cur = endLabelCandidates[i];
        if (cur.yLabel - prev.yLabel < endLabelMinGap) {
            cur.yLabel = prev.yLabel + endLabelMinGap;
        }
    }

    const minLabelY = pad.top + 10;
    const maxLabelY = y(0) - 8;
    for (let i = endLabelCandidates.length - 1; i >= 0; i--) {
        const cur = endLabelCandidates[i];
        if (cur.yLabel > maxLabelY) cur.yLabel = maxLabelY;
        if (i > 0) {
            const prev = endLabelCandidates[i - 1];
            if (cur.yLabel - prev.yLabel < endLabelMinGap) {
                prev.yLabel = cur.yLabel - endLabelMinGap;
            }
        }
    }
    endLabelCandidates.forEach(c => {
        if (c.yLabel < minLabelY) c.yLabel = minLabelY;
    });

    const endLabels = endLabelCandidates.map((c, idx) => {
        const sideOffset = idx % 2 === 0 ? 10 : 20;
        const xLabel = c.xEnd - sideOffset;
        return `<text x="${xLabel}" y="${c.yLabel}" text-anchor="end" class="dashboard-frequency-end-label" data-series="${c.si}" style="--series-color:${palette[c.si % palette.length]}">${escapeHtml(c.text)}</text>`;
    }).join('');

    el.innerHTML = `
    <div class="dashboard-frequency-chart-wrap">
        <div class="dashboard-frequency-controls">
            <button type="button" class="dashboard-frequency-toggle ${period === '7d' ? 'is-active' : ''}" data-period="7d">7d</button>
            <button type="button" class="dashboard-frequency-toggle ${period === '30d' ? 'is-active' : ''}" data-period="30d">30d</button>
        </div>
        <div class="dashboard-frequency-chart-tooltip" id="dashboardFrequencyTooltip" hidden></div>
        <svg class="dashboard-frequency-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-label="Produtividade acumulada por tarefa em linhas">
            ${yTicks.map(t => `<line x1="${pad.left}" y1="${y(t)}" x2="${w - pad.right}" y2="${y(t)}" class="dashboard-frequency-grid-line"/>`).join('')}
            ${seriesPaths}
            ${seriesDots}
            ${endLabels}
            ${labels.map(l => `<text x="${x(l.i)}" y="${h - 8}" text-anchor="middle" class="dashboard-frequency-chart-label">${escapeHtml(l.day)}</text>`).join('')}
            ${yTicks.slice(1).map(t => `<text x="${pad.left - 6}" y="${y(t) + 4}" text-anchor="end" class="dashboard-frequency-chart-axis">${t}</text>`).join('')}
        </svg>
        <p class="dashboard-frequency-chart-legend">Índice acumulado por tarefa. A linha sobe quando você conclui a tarefa.</p>
    </div>`;

    const svg = el.querySelector('.dashboard-frequency-chart-svg');
    const tooltip = el.querySelector('#dashboardFrequencyTooltip');
    const lines = el.querySelectorAll('.dashboard-frequency-series-line');
    const dots = el.querySelectorAll('.dashboard-frequency-series-dot');
    const endLabelEls = el.querySelectorAll('.dashboard-frequency-end-label');
    const toggles = el.querySelectorAll('.dashboard-frequency-toggle');

    function setSeriesHighlight(seriesIdx) {
        lines.forEach(line => {
            const isCurrent = line.dataset.series === String(seriesIdx);
            line.classList.toggle('is-muted', seriesIdx !== null && !isCurrent);
            line.classList.toggle('is-focused', seriesIdx !== null && isCurrent);
        });
        dots.forEach(dot => {
            const isCurrent = dot.dataset.series === String(seriesIdx);
            dot.classList.toggle('is-muted', seriesIdx !== null && !isCurrent);
            dot.classList.toggle('is-focused', seriesIdx !== null && isCurrent);
        });
        endLabelEls.forEach(label => {
            const isCurrent = label.dataset.series === String(seriesIdx);
            label.classList.toggle('is-muted', seriesIdx !== null && !isCurrent);
            label.classList.toggle('is-focused', seriesIdx !== null && isCurrent);
        });
    }

    dots.forEach(dot => {
        dot.addEventListener('mouseenter', () => {
            if (!tooltip || !svg) return;
            const sIdx = Number(dot.dataset.series);
            const s = series[sIdx];
            if (!s) return;
            setSeriesHighlight(sIdx);
            const date = dot.dataset.date || '';
            const value = dot.dataset.value || '0';
            const stateText = dot.dataset.state === 'done' ? 'Concluída' : 'Não concluída';
            tooltip.innerHTML = `<strong>${escapeHtml(s.name)}</strong><br>${escapeHtml(date)}<br>Índice acumulado: ${value}<br>Status: ${stateText}`;
            tooltip.hidden = false;
            const svgRect = svg.getBoundingClientRect();
            const dotBox = dot.getBoundingClientRect();
            tooltip.style.left = `${dotBox.left - svgRect.left + dotBox.width / 2}px`;
            tooltip.style.top = `${dotBox.top - svgRect.top - 8}px`;
        });
        dot.addEventListener('mouseleave', () => {
            if (tooltip) tooltip.hidden = true;
            setSeriesHighlight(null);
        });
    });

    toggles.forEach(btn => {
        btn.addEventListener('click', () => {
            const nextPeriod = btn.dataset.period === '7d' ? '7d' : '30d';
            if (window._dashboardFrequencyPeriod === nextPeriod) return;
            const host = document.getElementById('dashboardFrequencyContent');
            if (host) host.classList.add('is-period-transitioning-out');
            setTimeout(() => {
                window._dashboardFrequencyPeriod = nextPeriod;
                renderFrequencyChart();
                const hostIn = document.getElementById('dashboardFrequencyContent');
                if (!hostIn) return;
                hostIn.classList.remove('is-period-transitioning-out');
                hostIn.classList.add('is-period-transitioning-in');
                setTimeout(() => {
                    hostIn.classList.remove('is-period-transitioning-in');
                }, 220);
            }, 130);
        });
    });
}

// Gráficos estatísticos: donut (por tipo), barras (7 dias), círculo (taxa hoje)
function renderStatsCharts(routinesToday, completedCountToday) {
    const todayStr = getLocalDateStr(new Date());
    const totalToday = routinesToday.length;
    const taxaHoje = totalToday > 0 ? Math.round((completedCountToday / totalToday) * 100) : 0;

    // 1) Donut: distribuição por tipo (bulletType)
    const typeLabels = { reminder: 'Lembrete', task: 'Tarefa', commitment: 'Compromisso', important: 'Importante' };
    const typeColors = { reminder: '#111827', task: '#4b5563', commitment: '#9ca3af', important: '#dc2626' };
    const typeCounts = { reminder: 0, task: 0, commitment: 0, important: 0 };
    allRoutines.forEach(r => {
        const t = r.bulletType && typeCounts.hasOwnProperty(r.bulletType) ? r.bulletType : 'task';
        typeCounts[t]++;
    });
    const typeTotal = allRoutines.length || 1;
    const typeData = ['reminder', 'task', 'commitment', 'important'].map(key => ({
        key,
        label: typeLabels[key],
        count: typeCounts[key],
        pct: typeTotal ? (typeCounts[key] / typeTotal) * 100 : 0
    }));

    const donutEl = document.getElementById('dashboardDonutTypeContent');
    if (donutEl) {
        const size = 152;
        const cx = size / 2;
        const cy = size / 2;
        const r = 54;
        const stroke = 16;
        let offset = 0;
        const segments = typeData.filter(d => d.count > 0).map(d => {
            const len = (d.pct / 100) * 2 * Math.PI * r;
            const seg = { len, color: typeColors[d.key], label: d.label, count: d.count };
            offset += len;
            return seg;
        });
        const circumference = 2 * Math.PI * r;
        let dashOffset = circumference / 4;
        const pathArcs = segments.map(seg => {
            const dashLen = seg.len;
            dashOffset -= dashLen;
            return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${stroke}" stroke-dasharray="${dashLen} ${circumference}" stroke-dashoffset="${dashOffset}" class="dashboard-donut-segment"/>`;
        }).join('');
        const legend = typeData.filter(d => d.count > 0).map(d =>
            `<span class="dashboard-donut-legend-item"><span class="dashboard-donut-legend-dot" style="background:${typeColors[d.key]}"></span>${escapeHtml(d.label)} (${d.count})</span>`
        ).join('');
        donutEl.innerHTML = `
        <div class="dashboard-donut-wrap">
            <svg class="dashboard-donut-svg" viewBox="0 0 ${size} ${size}" aria-label="Distribuição por tipo">
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--color-border-neutral)" stroke-width="${stroke}"/>
                ${pathArcs}
                <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="dashboard-donut-center-value">${typeTotal}</text>
                <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="dashboard-donut-center-label">rotinas</text>
            </svg>
            <div class="dashboard-donut-legend">${legend || '<span class="dashboard-donut-empty">Nenhuma rotina</span>'}</div>
        </div>`;
    }

    // 2) Barras: últimos 7 dias — concluídas (verde) vs pendentes (cinza), escala por total agendado
    const weekDataDone = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = getLocalDateStr(d);
        const routinesOnDay = allRoutines.filter((r) => isRoutineDate(dateStr, r));
        const total = routinesOnDay.length;
        const done = routinesOnDay.filter((r) => getRoutineCompletedDates(r).has(dateStr)).length;
        weekDataDone.push({ dateStr, total, done, pending: Math.max(0, total - done) });
    }
    const maxWeek = Math.max(1, ...weekDataDone.map(x => x.total));
    const barEl = document.getElementById('dashboardBarWeekContent');
    if (barEl) {
        const w = 220;
        const h = 100;
        const pad = { left: 18, right: 10, top: 12, bottom: 24 };
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;
        const barW = plotW / 7 * 0.7;
        const gap = plotW / 7 * 0.3;
        const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const stackColors = {
            done: '#16a34a',
            pending: '#d1d5db'
        };
        const bars = weekDataDone.map((item, i) => {
            const x = pad.left + i * (plotW / 7) + gap / 2;
            const dayName = dayLabels[new Date(item.dateStr + 'T12:00:00').getDay()];
            let stacks = '';
            if (item.total <= 0) {
                return `<g><text x="${x + barW / 2}" y="${h - 8}" text-anchor="middle" class="dashboard-bar-week-label">${escapeHtml(dayName)}</text></g>`;
            }
            const barTotalH = (item.total / maxWeek) * plotH;
            const hDone = item.total > 0 ? (item.done / item.total) * barTotalH : 0;
            const hPen = item.total > 0 ? (item.pending / item.total) * barTotalH : 0;
            const y0 = pad.top + plotH;
            const yPenTop = y0 - hPen;
            const yDoneTop = yPenTop - hDone;
            if (hPen > 0.5) {
                stacks += `<rect x="${x}" y="${yPenTop}" width="${barW}" height="${hPen}" class="dashboard-bar-week-fill dashboard-bar-week-fill--pending" fill="${stackColors.pending}" rx="4" ry="4"/>`;
            }
            if (hDone > 0.5) {
                stacks += `<rect x="${x}" y="${yDoneTop}" width="${barW}" height="${hDone}" class="dashboard-bar-week-fill dashboard-bar-week-fill--done" fill="${stackColors.done}" rx="4" ry="4"/>`;
            }
            return `<g>${stacks}<text x="${x + barW / 2}" y="${h - 8}" text-anchor="middle" class="dashboard-bar-week-label">${escapeHtml(dayName)}</text></g>`;
        }).join('');
        const legend =
            `<span class="dashboard-bar-week-legend-item"><span class="dashboard-bar-week-legend-dot" style="background:${stackColors.done}"></span>Concluídas</span>` +
            `<span class="dashboard-bar-week-legend-item"><span class="dashboard-bar-week-legend-dot" style="background:${stackColors.pending}"></span>Pendentes</span>`;
        barEl.innerHTML = `
        <div class="dashboard-bar-week-wrap">
            <svg class="dashboard-bar-week-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-label="Últimos 7 dias — concluídas e pendentes">
                ${bars}
            </svg>
            <div class="dashboard-bar-week-legend">${legend}</div>
        </div>`;
    }

    // 3) Círculo: taxa de conclusão hoje (%)
    const circleEl = document.getElementById('dashboardCircleTodayContent');
    if (circleEl) {
        const size = 108;
        const cx = size / 2;
        const cy = size / 2;
        const r = 40;
        const stroke = 11;
        const circumference = 2 * Math.PI * r;
        /* 100% = arco completo (evita erro de vírgula flutuante) */
        const dashLen = taxaHoje >= 100 ? circumference : (taxaHoje / 100) * circumference;
        /* Sem rotinas hoje: neutro. Com rotinas: sempre verde (tom mais forte em 100%). */
        var circleState = 'neutral';
        var progressStroke = '#475569';
        if (totalToday > 0) {
            if (taxaHoje >= 100) {
                circleState = 'complete';
                progressStroke = '#15803d';
            } else {
                circleState = 'pending';
                progressStroke = '#22c55e';
            }
        }
        /* Rotação -90°: o traço SVG começa às 3h; assim o progresso começa ao meio-dia e 100% fecha o círculo. */
        const progressGroup = `<g transform="rotate(-90 ${cx} ${cy})">
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${progressStroke}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${dashLen} ${circumference}" stroke-dashoffset="0" class="dashboard-circle-today-progress dashboard-circle-today-progress--${circleState}"/>
                ${taxaHoje >= 100 ? '' : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="${Math.max(2, stroke - 8)}" stroke-linecap="round" stroke-dasharray="${Math.max(9, dashLen * 0.14)} ${circumference}" stroke-dashoffset="0" class="dashboard-circle-today-loading"/>`}
            </g>`;
        circleEl.innerHTML = `
        <div class="dashboard-circle-today-wrap dashboard-circle-today-wrap--${circleState}">
            <svg class="dashboard-circle-today-svg" viewBox="0 0 ${size} ${size}" aria-label="Taxa de conclusão hoje ${taxaHoje}%">
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1f2937" stroke-opacity="0.24" stroke-width="${stroke}" class="dashboard-circle-today-track"/>
                ${progressGroup}
            </svg>
            <span class="dashboard-circle-today-value dashboard-circle-today-value--${circleState}">${taxaHoje}%</span>
        </div>`;
    }
}

// Renderiza bloco de estatísticas (KPIs)
function renderStats(completedCountToday) {
    const el = document.getElementById('dashboardStatsContent');
    if (!el) return;
    const todayStr = getLocalDateStr(new Date());
    const routinesToday = allRoutines.filter(r => isRoutineDate(todayStr, r));
    const totalToday = routinesToday.length;
    const taxaHoje = totalToday > 0 ? Math.round((completedCountToday / totalToday) * 100) : 0;
    const totalRoutines = allRoutines.length;
    const overdue = getOverdueCount();
    const maxStreak = allRoutines.length ? Math.max(0, ...allRoutines.map(r => getCurrentStreak(r))) : 0;
    const now = new Date();
    const thisMonth = now.getFullYear() * 100 + (now.getMonth() + 1);
    const daysActiveThisMonth = new Set();
    allRoutines.forEach(r => {
        const dates = getRoutineCompletedDates(r);
        dates.forEach(dateStr => {
            const y = parseInt(dateStr.slice(0, 4), 10);
            const m = parseInt(dateStr.slice(5, 7), 10);
            if (y * 100 + m === thisMonth) daysActiveThisMonth.add(dateStr);
        });
    });
    const stats = [
        { label: 'Total de rotinas', value: totalRoutines },
        { label: 'Concluídas hoje', value: completedCountToday },
        { label: 'Taxa hoje', value: taxaHoje + '%' },
        { label: 'Atrasadas', value: overdue },
        { label: 'Maior sequência', value: maxStreak },
        { label: 'Dias ativos no mês', value: daysActiveThisMonth.size }
    ];
    el.innerHTML = '<div class="dashboard-stats-grid">' + stats.map(s =>
        `<div class="dashboard-stat-item"><span class="dashboard-stat-value">${s.value}</span><span class="dashboard-stat-label">${escapeHtml(s.label)}</span></div>`
    ).join('') + '</div>';
}

// Dados para gráfico de área (Status): últimos 12 dias
function getStatusSeriesData(statusForRoutine) {
    const now = new Date();
    const todayStr = getLocalDateStr(now);
    const currentTimeMin = now.getHours() * 60 + now.getMinutes();
    const days = 12;
    const doneArr = [];
    const progressArr = [];
    const pendingArr = [];
    const labels = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = getLocalDateStr(d);
        const routinesOnDay = allRoutines.filter(r => isRoutineDate(dateStr, r));
        let done = 0, progress = 0, pending = 0;
        routinesOnDay.forEach(r => {
            const completed = getRoutineCompletedDates(r).has(dateStr);
            if (completed) {
                done++;
            } else if (dateStr === todayStr) {
                const s = statusForRoutine(r).status;
                if (s === 'progress') progress++;
                else pending++;
            } else {
                pending++;
            }
        });
        doneArr.push(done);
        progressArr.push(progress);
        pendingArr.push(pending);
        labels.push(i === 0 ? 'Hoje' : 'D' + (days - i));
    }
    return { done: doneArr, progress: progressArr, pending: pendingArr, labels };
}

// Escala “nice” para eixo Y (múltiplos de 1, 2, 5, 10…)
function niceYMax(maxVal) {
    if (maxVal <= 0) return 1;
    const order = Math.pow(10, Math.floor(Math.log10(maxVal)));
    const norm = maxVal / order;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return Math.ceil(maxVal / (order * step)) * order * step;
}

// Renderiza gráfico de Status hoje (área – explicativo e profissional)
function renderStatusChart(routinesToday, completedTodaySet, statusForRoutine) {
    const el = document.getElementById('dashboardStatusChart');
    if (!el) return;
    const { done, progress, pending, labels } = getStatusSeriesData(statusForRoutine);
    const allValues = [...done, ...progress, ...pending];
    const rawMax = Math.max(...allValues, 0);
    const yMax = Math.max(1, niceYMax(rawMax));
    const w = 520, h = 176;
    const pad = { left: 34, right: 18, top: 30, bottom: 30 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const n = labels.length;
    const x = (i) => pad.left + (i / Math.max(1, n - 1)) * plotW;
    const y = (v) => pad.top + plotH - (v / yMax) * plotH;

    const series = [
        { data: done, label: 'Concluída', color: '#111827', opacity: 0.78 },
        { data: progress, label: 'Em andamento', color: '#4b5563', opacity: 0.74 },
        { data: pending, label: 'Pendente', color: '#9ca3af', opacity: 0.68 }
    ];

    const yTicks = 5;
    let yAxisLabels = '';
    for (let t = 0; t <= yTicks; t++) {
        const val = Math.round((t / yTicks) * yMax);
        const gy = pad.top + plotH - (t / yTicks) * plotH;
        yAxisLabels += `<text x="${pad.left - 6}" y="${gy + 4}" text-anchor="end" class="dashboard-stat-chart-axis dashboard-stat-chart-yaxis">${val}</text>`;
    }

    let grid = '';
    for (let g = 0; g <= 5; g++) {
        const gy = pad.top + (g / 5) * plotH;
        grid += `<line x1="${pad.left}" y1="${gy}" x2="${w - pad.right}" y2="${gy}" class="dashboard-stat-chart-grid"/>`;
    }
    for (let g = 0; g <= 5; g++) {
        const gx = pad.left + (g / 5) * plotW;
        grid += `<line x1="${gx}" y1="${pad.top}" x2="${gx}" y2="${h - pad.bottom}" class="dashboard-stat-chart-grid"/>`;
    }

    let areas = '';
    series.forEach((s) => {
        let path = `M ${x(0)} ${h - pad.bottom}`;
        s.data.forEach((v, i) => { path += ` L ${x(i)} ${y(v)}`; });
        path += ` L ${x(n - 1)} ${h - pad.bottom} Z`;
        areas += `<path d="${path}" fill="${s.color}" fill-opacity="${s.opacity}" class="dashboard-stat-chart-area"/>`;
    });

    const lastIdx = n - 1;
    const hojeResumo = `Hoje: ${done[lastIdx]} concluídas · ${progress[lastIdx]} em andamento · ${pending[lastIdx]} pendentes`;
    let legend = series.map(s =>
        `<span class="dashboard-stat-chart-legend-item"><span class="dashboard-stat-chart-legend-dot" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>`
    ).join('');

    const xLabels = labels.map((lbl, i) =>
        `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" class="dashboard-stat-chart-axis">${escapeHtml(lbl)}</text>`
    ).join('');

    const dataLabels = series.map((s, idx) => {
        const v = s.data[lastIdx];
        const px = x(lastIdx) + 6;
        const py = y(v) + idx * 5;
        return `<text x="${px}" y="${py + 4}" class="dashboard-stat-chart-datalabel" fill="${s.color}">${v}</text>`;
    }).join('');

    el.innerHTML = `
    <div class="dashboard-stat-chart-wrap dashboard-stat-chart-wrap--area">
        <div class="dashboard-stat-chart-summary">${escapeHtml(hojeResumo)}</div>
        <div class="dashboard-stat-chart-legend dashboard-stat-chart-legend--center">${legend}</div>
        <svg class="dashboard-stat-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-label="Status: ${escapeHtml(hojeResumo)}">
            <g class="dashboard-stat-chart-grid-group">${grid}</g>
            <g class="dashboard-stat-chart-yaxis-group">${yAxisLabels}</g>
            <g class="dashboard-stat-chart-areas">${areas}</g>
            <g class="dashboard-stat-chart-datalabels">${dataLabels}</g>
            <g class="dashboard-stat-chart-xlabels">${xLabels}</g>
        </svg>
        <div class="dashboard-stat-chart-period">Eixo X: dias · Eixo Y: quantidade</div>
    </div>`;
}

// Dados para gráfico de linhas (Tipo): últimos 5 dias por bulletType
function getTypeSeriesData() {
    const now = new Date();
    const days = 5;
    const keys = ['reminder', 'task', 'commitment', 'important'];
    const labels = [];
    const series = { reminder: [], task: [], commitment: [], important: [] };
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = getLocalDateStr(d);
        const counts = { reminder: 0, task: 0, commitment: 0, important: 0 };
        allRoutines.forEach(r => {
            if (!isRoutineDate(dateStr, r)) return;
            const t = keys.includes(r.bulletType) ? r.bulletType : 'task';
            counts[t]++;
        });
        keys.forEach(k => series[k].push(counts[k]));
        labels.push(i === 0 ? 'Hoje' : 'D' + (days - i));
    }
    return { series, labels, keys };
}

// Renderiza gráfico de Tipo (linhas com marcadores – explicativo e profissional)
function renderBulletTypeChart() {
    const el = document.getElementById('dashboardTypeChart');
    if (!el) return;
    const typeLabels = { reminder: 'Lembrete', task: 'Tarefa', commitment: 'Compromisso', important: 'Importante' };
    const { series, labels, keys } = getTypeSeriesData();
    const allVals = keys.flatMap(k => series[k]);
    const rawMax = Math.max(...allVals, 0);
    const yMax = Math.max(1, niceYMax(rawMax));
    const w = 520, h = 164;
    const pad = { left: 34, right: 18, top: 28, bottom: 28 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const n = labels.length;
    const x = (i) => pad.left + (i / Math.max(1, n - 1)) * plotW;
    const y = (v) => pad.top + plotH - (v / yMax) * plotH;

    const colors = ['#111827', '#4b5563', '#9ca3af', '#dc2626'];
    const lineSeries = keys.map((key, idx) => ({
        data: series[key],
        label: typeLabels[key],
        color: colors[idx % colors.length]
    }));

    const yTicks = 5;
    let yAxisLabels = '';
    for (let t = 0; t <= yTicks; t++) {
        const val = Math.round((t / yTicks) * yMax);
        const gy = pad.top + plotH - (t / yTicks) * plotH;
        yAxisLabels += `<text x="${pad.left - 6}" y="${gy + 4}" text-anchor="end" class="dashboard-stat-chart-axis dashboard-stat-chart-yaxis">${val}</text>`;
    }

    let grid = '';
    for (let g = 0; g <= 5; g++) {
        const gy = pad.top + (g / 5) * plotH;
        grid += `<line x1="${pad.left}" y1="${gy}" x2="${w - pad.right}" y2="${gy}" class="dashboard-stat-chart-grid"/>`;
    }
    for (let g = 0; g <= 5; g++) {
        const gx = pad.left + (g / 5) * plotW;
        grid += `<line x1="${gx}" y1="${pad.top}" x2="${gx}" y2="${h - pad.bottom}" class="dashboard-stat-chart-grid"/>`;
    }

    let linesAndDots = '';
    lineSeries.forEach(s => {
        const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
        linesAndDots += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" class="dashboard-stat-chart-line"/>`;
        s.data.forEach((v, i) => {
            linesAndDots += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${s.color}" class="dashboard-stat-chart-marker"/>`;
        });
    });

    const lastIdx = n - 1;
    const hojeVals = lineSeries.map(s => `${s.label}: ${s.data[lastIdx]}`).join(' · ');
    const hojeResumo = `Hoje: ${hojeVals}`;
    let legend = lineSeries.map(s =>
        `<span class="dashboard-stat-chart-legend-item"><span class="dashboard-stat-chart-legend-dot" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>`
    ).join('');

    const xLabels = labels.map((lbl, i) =>
        `<text x="${x(i)}" y="${h - 6}" text-anchor="middle" class="dashboard-stat-chart-axis">${escapeHtml(lbl)}</text>`
    ).join('');

    const dataLabels = lineSeries.map((s, idx) => {
        const v = s.data[lastIdx];
        const px = x(lastIdx) + 8;
        const py = y(v) + idx * 4;
        return `<text x="${px}" y="${py + 4}" class="dashboard-stat-chart-datalabel" fill="${s.color}">${v}</text>`;
    }).join('');

    el.innerHTML = `
    <div class="dashboard-stat-chart-wrap dashboard-stat-chart-wrap--line">
        <div class="dashboard-stat-chart-summary">${escapeHtml(hojeResumo)}</div>
        <div class="dashboard-stat-chart-legend dashboard-stat-chart-legend--right">${legend}</div>
        <svg class="dashboard-stat-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-label="Tipos: ${escapeHtml(hojeResumo)}">
            <g class="dashboard-stat-chart-grid-group">${grid}</g>
            <g class="dashboard-stat-chart-yaxis-group">${yAxisLabels}</g>
            <g class="dashboard-stat-chart-lines">${linesAndDots}</g>
            <g class="dashboard-stat-chart-datalabels">${dataLabels}</g>
            <g class="dashboard-stat-chart-xlabels">${xLabels}</g>
        </svg>
        <div class="dashboard-stat-chart-period">Eixo X: dias · Eixo Y: quantidade</div>
    </div>`;
}

// Renderiza card Atrasadas (número + hint)
function renderOverdueCard() {
    const el = document.getElementById('dashboardOverdueChart');
    if (!el) return;
    const count = getOverdueCount();
    el.innerHTML = `<p class="dashboard-overdue-value ${count === 0 ? 'dashboard-overdue-value--zero' : ''}">${count}</p><p class="dashboard-overdue-hint">Últimos 7 dias</p>`;
}

// Gerar calendário de um mês
function generateMonthCalendar(year, month, allCheckIns, routine) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay(); // 0 = Domingo, 6 = Sábado
    
    // Nome do mês (abreviação)
    const monthNames = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    const monthName = monthNames[month];
    
    // Criar array de semanas
    const weeks = [];
    let currentWeek = [];
    
    // Adicionar espaços vazios no início
    for (let i = 0; i < startingDayOfWeek; i++) {
        currentWeek.push(null);
    }
    
    // Adicionar dias do mês (usar isRoutineDate para mensal/semanal/diário – só assim o dia 1 mensal não marca todos os dias)
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = date.toISOString().split('T')[0];
        const routineDay = !routine ? true : isRoutineDate(dateStr, routine);
        currentWeek.push({
            day: day,
            date: dateStr,
            checked: allCheckIns.has(dateStr),
            routineDay: routineDay
        });
        
        // Se completou uma semana (7 dias), adicionar à lista de semanas
        if (currentWeek.length === 7) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
    }
    
    // Adicionar última semana incompleta
    if (currentWeek.length > 0) {
        // Preencher com nulls até completar 7 dias
        while (currentWeek.length < 7) {
            currentWeek.push(null);
        }
        weeks.push(currentWeek);
    }
    
    return {
        monthName,
        year,
        month,
        weeks
    };
}

// Normalizar data para YYYY-MM-DD (aceita ISO completa ou só a data)
function normalizeDateStr(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

// Obter datas de conclusão de uma única rotina
function getRoutineCompletedDates(routine) {
    const dates = new Set();
    const add = (dateStr) => {
        const d = normalizeDateStr(dateStr);
        if (d) dates.add(d);
    };
    if (routine.tasks) {
        routine.tasks.forEach(task => {
            if (task.completedDates) {
                task.completedDates.forEach(add);
            }
        });
    }
    if (routine.checkIns) {
        routine.checkIns.forEach(add);
    }
    return dates;
}

// Formatar data local como YYYY-MM-DD
function getLocalDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Sequência de dias consecutivos (terminando hoje ou ontem)
function getCurrentStreak(routine) {
    const dates = getRoutineCompletedDates(routine);
    if (dates.size === 0) return 0;
    
    const now = new Date();
    const today = getLocalDateStr(now);
    const yesterday = getLocalDateStr(new Date(now.getTime() - 86400000));
    
    if (!dates.has(today) && !dates.has(yesterday)) return 0;
    
    let streak = 0;
    let checkDate = dates.has(today) ? today : yesterday;
    
    while (dates.has(checkDate)) {
        streak++;
        const d = new Date(checkDate + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        checkDate = getLocalDateStr(d);
    }
    return streak;
}

// Modo debug: obter data de referência a partir dos parâmetros da URL (?mes=0-11&ano=YYYY)
function getReferenceDate() {
    const params = new URLSearchParams(window.location.search);
    const mes = params.get('mes');
    const ano = params.get('ano');
    const now = new Date();
    if (mes !== null) {
        const m = parseInt(mes, 10);
        if (m >= 0 && m <= 11) {
            const y = ano !== null ? parseInt(ano, 10) : now.getFullYear();
            return new Date(y, m, 1);
        }
    }
    return now;
}

// Gerar heatmap para uma única rotina (13 meses: 6 anteriores + atual + 6 próximos)
function generateRoutineHeatmap(routine, offset = 0) {
    const allCheckIns = getRoutineCompletedDates(routine);
    const referenceDate = getReferenceDate();
    const centerDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + offset, 1);
    const monthDataList = [];
    for (let i = -6; i <= 6; i++) {
        const d = new Date(centerDate.getFullYear(), centerDate.getMonth() + i, 1);
        monthDataList.push(generateMonthCalendar(d.getFullYear(), d.getMonth(), allCheckIns, routine));
    }
    const monthsHTML = monthDataList.map((monthData, index) => {
        const monthIndex = index - 6; // -6 a 6 (0 = centro)
        const isCurrentMonth = monthIndex === 0;
        const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
        const weekdaysHTML = weekdays.map(day => `<div class="calendar-weekday">${day}</div>`).join('');
        const daysHTML = monthData.weeks.map(week => {
            return week.map(dayData => {
                if (dayData === null) {
                    return '<div class="heatmap-square empty"></div>';
                }
                const date = new Date(dayData.date);
                const dateFormatted = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const classes = ['heatmap-square'];
                if (dayData.routineDay) classes.push('routine-day');
                if (dayData.checked) classes.push('checked');
                return `
                    <div class="${classes.join(' ')}" 
                         data-date="${dayData.date}"
                         data-date-formatted="${dateFormatted}">
                        <span class="heatmap-day-number">${dayData.day}</span>
                    </div>
                `;
            }).join('');
        }).join('');
        return `
            <div class="calendar-month${isCurrentMonth ? ' calendar-month--current' : ''}" data-month-index="${monthIndex}">
                <div class="calendar-month-header">${monthData.monthName}</div>
                <div class="calendar-weekdays">${weekdaysHTML}</div>
                <div class="calendar-days-grid">${daysHTML}</div>
            </div>
        `;
    }).join('');
    return `
        <div class="large-heatmap-block" data-routine-id="${routine.id}">
            <div class="calendar-months-container">
                ${monthsHTML}
            </div>
        </div>
    `;
}

// Label do tipo de planejamento para exibição
function getPlanTypeLabel(planType) {
    const t = planType || 'daily';
    return { daily: 'Dia', weekly: 'Semana', monthly: 'Mensal' }[t] || 'Dia';
}

// Verifica se o valor parece um nome de ícone Lucide (compatibilidade com emojis antigos)
function getLucideIconName(icon) {
    if (!icon || typeof icon !== 'string') return 'clipboard-list';
    const trimmed = icon.trim();
    if (!trimmed) return 'clipboard-list';
    if (trimmed.length <= 2 || /[^\w-]/.test(trimmed)) return 'clipboard-list';
    return trimmed;
}

// Retorna a anotação da tarefa para uma data (annotationsByDate[date] ou fallback annotation)
function getTaskAnnotationForDate(task, dateStr) {
    if (!task) return null;
    const list = getTaskAnnotationsListForDate(task, dateStr);
    if (list && list.length > 0) return list[list.length - 1];
    if (task.annotation && task.annotation.type) return task.annotation;
    return null;
}

// Retorna array de anotações nomeadas para a tarefa na data (normaliza formato antigo para array)
function getTaskAnnotationsListForDate(task, dateStr) {
    if (!task) return [];
    const raw = task.annotationsByDate && task.annotationsByDate[dateStr];
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && raw.type) return [{ name: 'Anotação', type: raw.type, data: raw.data != null ? raw.data : '' }];
    return [];
}

var ANNOTATION_TYPE_NAMES = { digitalizando: 'Digitalizando', caderno: 'Caderno', mental: 'Diagrama' };

var _agendaMenuDropdown = null;
function closeAgendaTaskMenu() {
    if (_agendaMenuDropdown && _agendaMenuDropdown.parentNode) _agendaMenuDropdown.parentNode.removeChild(_agendaMenuDropdown);
    _agendaMenuDropdown = null;
    var m = document.getElementById('agendaHistoryModal');
    if (m) m.remove();
    document.removeEventListener('click', closeAgendaTaskMenu);
}
function openAgendaTaskMenu(anchorBtn, routineId, taskId, dateStr) {
    closeAgendaTaskMenu();
    var routine = allRoutines && allRoutines.find(function(r) { return r.id === routineId; });
    var task = routine && routine.tasks ? routine.tasks.find(function(t) { return t.id === taskId; }) : null;
    if (!routine || !task) return;
    var rect = anchorBtn.getBoundingClientRect();
    _agendaMenuDropdown = document.createElement('div');
    _agendaMenuDropdown.className = 'agenda-menu-dropdown';
    _agendaMenuDropdown.style.cssText = 'position:fixed;left:' + (rect.right - 160) + 'px;top:' + (rect.bottom + 4) + 'px;z-index:1100;min-width:180px;';
    _agendaMenuDropdown.innerHTML = '<button type="button" class="agenda-menu-item" data-action="history">Histórico desta tarefa</button><button type="button" class="agenda-menu-item" data-action="day-history">Histórico do dia</button><button type="button" class="agenda-menu-item" data-action="delete">Excluir anotações</button>';
    document.body.appendChild(_agendaMenuDropdown);
    _agendaMenuDropdown.querySelector('[data-action="history"]').onclick = function() {
        closeAgendaTaskMenu();
        showAgendaHistoryModal(routineId, taskId, dateStr);
    };
    _agendaMenuDropdown.querySelector('[data-action="day-history"]').onclick = function() {
        closeAgendaTaskMenu();
        showAgendaDayHistoryModal(dateStr);
    };
    _agendaMenuDropdown.querySelector('[data-action="delete"]').onclick = function() {
        closeAgendaTaskMenu();
        showAgendaDeleteModal(routineId, taskId, dateStr);
    };
    setTimeout(function() { document.addEventListener('click', closeAgendaTaskMenu); }, 0);
}
// Retorna lista de todas as anotações de um dia (todas rotinas/tarefas), cada item: { routine, task, dateStr, annotations, annIndex }
function getAnnotationsForDay(dateStr) {
    var list = [];
    (allRoutines || []).forEach(function(routine) {
        (routine.tasks || []).forEach(function(task) {
            var annotations = getTaskAnnotationsListForDate(task, dateStr);
            if (annotations && annotations.length > 0) {
                annotations.forEach(function(ann, idx) {
                    list.push({ routine: routine, task: task, dateStr: dateStr, annotations: annotations, annIndex: idx });
                });
            }
        });
    });
    list.sort(function(a, b) {
        var ta = a.annotations[a.annIndex].lastUpdated ? new Date(a.annotations[a.annIndex].lastUpdated).getTime() : 0;
        var tb = b.annotations[b.annIndex].lastUpdated ? new Date(b.annotations[b.annIndex].lastUpdated).getTime() : 0;
        return ta - tb;
    });
    return list;
}

function showAgendaDayHistoryModal(dateStr) {
    var dayEntries = getAnnotationsForDay(dateStr);
    if (dayEntries.length === 0) return;
    var modal = document.createElement('div');
    modal.id = 'agendaDayHistoryModal';
    modal.className = 'agenda-history-modal agenda-day-history-modal';
    var dateLabel = dateStr;
    try {
        var p = dateStr.split('-');
        if (p.length >= 3) {
            var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
            dateLabel = d.getDate() + ' ' + (MONTH_NAMES[d.getMonth()] || '') + ' ' + d.getFullYear();
        }
    } catch (_) {}
    modal.innerHTML = '<div class="agenda-history-backdrop"></div><div class="agenda-history-content"><h3 class="agenda-history-title">Histórico do dia</h3><p class="agenda-day-history-date">' + escapeHtml(dateLabel) + '</p><ul class="agenda-history-list agenda-day-history-list"></ul><button type="button" class="agenda-history-close">Fechar</button></div>';
    var listEl = modal.querySelector('.agenda-day-history-list');
    dayEntries.forEach(function(entry) {
        var ann = entry.annotations[entry.annIndex];
        var name = (ann.name && String(ann.name).trim()) ? String(ann.name).trim() : (ANNOTATION_TYPE_NAMES[ann.type] || ann.type || 'Anotação');
        var taskLabel = (entry.task.text && String(entry.task.text).trim()) ? String(entry.task.text).trim() : 'Tarefa';
        var routineLabel = (entry.routine.title && String(entry.routine.title).trim()) ? String(entry.routine.title).trim() : 'Rotina';
        var timeStr = formatAnnotationTime(ann.lastUpdated);
        var item = { routine: entry.routine, task: entry.task, dateStr: entry.dateStr, annotations: entry.annotations };
        var li = document.createElement('li');
        li.className = 'agenda-day-history-item';
        li.innerHTML = '<span class="agenda-day-history-meta">' + escapeHtml(routineLabel) + ' · ' + escapeHtml(taskLabel) + '</span><span class="agenda-day-history-time">' + escapeHtml(timeStr) + '</span><span class="agenda-history-name">' + escapeHtml(name) + '</span><button type="button" class="agenda-history-abrir">Abrir</button><button type="button" class="agenda-history-biblioteca">Devolver para biblioteca</button>';
        li.querySelector('.agenda-history-abrir').onclick = function() {
            modal.remove();
            if (typeof openAnnotationViewer === 'function') openAnnotationViewer(item, entry.annIndex);
        };
        li.querySelector('.agenda-history-biblioteca').onclick = function() {
            modal.remove();
            if (typeof showRotinasView === 'function') showRotinasView();
            if (typeof switchRotinasView === 'function') switchRotinasView('biblioteca');
        };
        listEl.appendChild(li);
    });
    modal.querySelector('.agenda-history-close').onclick = function() { modal.remove(); };
    modal.querySelector('.agenda-history-backdrop').onclick = function() { modal.remove(); };
    document.body.appendChild(modal);
}

function showAgendaHistoryModal(routineId, taskId, dateStr) {
    var routine = allRoutines && allRoutines.find(function(r) { return r.id === routineId; });
    var task = routine && routine.tasks ? routine.tasks.find(function(t) { return t.id === taskId; }) : null;
    if (!routine || !task) return;
    var annotations = getTaskAnnotationsListForDate(task, dateStr);
    if (!annotations || annotations.length === 0) return;
    var modal = document.createElement('div');
    modal.id = 'agendaHistoryModal';
    modal.className = 'agenda-history-modal';
    modal.innerHTML = '<div class="agenda-history-backdrop"></div><div class="agenda-history-content"><h3 class="agenda-history-title">Histórico de anotações</h3><ul class="agenda-history-list"></ul><button type="button" class="agenda-history-close">Fechar</button></div>';
    var list = modal.querySelector('.agenda-history-list');
    var item = { routine: routine, task: task, dateStr: dateStr, annotations: annotations };
    annotations.forEach(function(ann, idx) {
        var name = (ann.name && String(ann.name).trim()) ? String(ann.name).trim() : (ANNOTATION_TYPE_NAMES[ann.type] || ann.type || 'Anotação');
        var li = document.createElement('li');
        li.innerHTML = '<span class="agenda-history-name">' + escapeHtml(name) + '</span><button type="button" class="agenda-history-abrir">Abrir</button><button type="button" class="agenda-history-biblioteca">Devolver para biblioteca</button>';
        li.querySelector('.agenda-history-abrir').onclick = function() {
            modal.remove();
            if (typeof openAnnotationViewer === 'function') openAnnotationViewer(item, idx);
        };
        li.querySelector('.agenda-history-biblioteca').onclick = function() {
            modal.remove();
            if (typeof showRotinasView === 'function') showRotinasView();
            if (typeof switchRotinasView === 'function') switchRotinasView('biblioteca');
        };
        list.appendChild(li);
    });
    modal.querySelector('.agenda-history-close').onclick = function() { modal.remove(); };
    modal.querySelector('.agenda-history-backdrop').onclick = function() { modal.remove(); };
    document.body.appendChild(modal);
}
function showAgendaDeleteModal(routineId, taskId, dateStr) {
    var routine = allRoutines && allRoutines.find(function(r) { return r.id === routineId; });
    var task = routine && routine.tasks ? routine.tasks.find(function(t) { return t.id === taskId; }) : null;
    if (!routine || !task) return;
    var annotations = getTaskAnnotationsListForDate(task, dateStr);
    if (!annotations || annotations.length === 0) return;
    var modal = document.createElement('div');
    modal.id = 'agendaDeleteModal';
    modal.className = 'agenda-history-modal agenda-delete-modal';
    var agendaTrashBtn = typeof trashBinButtonHTML === 'function' ? trashBinButtonHTML({ className: 'agenda-delete-btn-trash', labelText: 'Excluir selecionadas', title: 'Excluir selecionadas', ariaLabel: 'Excluir selecionadas' }) : '<button type="button" class="agenda-delete-btn-trash" title="Excluir selecionadas" aria-label="Excluir selecionadas">Excluir selecionadas</button>';
    modal.innerHTML = '<div class="agenda-history-backdrop"></div><div class="agenda-history-content"><h3 class="agenda-history-title">Excluir anotações</h3><p class="agenda-delete-hint">Selecione as anotações que deseja excluir.</p><ul class="agenda-delete-list"></ul><div class="agenda-delete-actions">' + agendaTrashBtn + '<button type="button" class="agenda-history-close">Fechar</button></div></div>';
    var list = modal.querySelector('.agenda-delete-list');
    annotations.forEach(function(ann, idx) {
        var name = (ann.name && String(ann.name).trim()) ? String(ann.name).trim() : (ANNOTATION_TYPE_NAMES[ann.type] || ann.type || 'Anotação');
        var li = document.createElement('li');
        li.className = 'agenda-delete-item';
        li.innerHTML = '<label class="agenda-delete-label"><input type="checkbox" class="agenda-delete-checkbox" data-index="' + idx + '"><span class="agenda-delete-name">' + escapeHtml(name) + '</span></label>';
        list.appendChild(li);
    });
    var trashBtn = modal.querySelector('.agenda-delete-btn-trash');
    trashBtn.onclick = function() {
        var checkboxes = modal.querySelectorAll('.agenda-delete-checkbox:checked');
        var selectedIndices = Array.from(checkboxes).map(function(cb) { return parseInt(cb.dataset.index, 10); }).sort(function(a, b) { return b - a; });
        if (selectedIndices.length === 0) {
            alert('Selecione ao menos uma anotação para excluir.');
            return;
        }
        if (!confirm('Realmente deseja excluir ' + selectedIndices.length + ' anota\u00e7\u00e3o(ões) selecionada(s)?')) return;
        deleteSelectedTaskAnnotations(routineId, taskId, dateStr, selectedIndices);
        modal.remove();
        if (typeof renderAgenda === 'function') renderAgenda();
        if (typeof renderBiblioteca === 'function') renderBiblioteca();
    };
    modal.querySelector('.agenda-history-close').onclick = function() { modal.remove(); };
    modal.querySelector('.agenda-history-backdrop').onclick = function() { modal.remove(); };
    document.body.appendChild(modal);
}
function deleteSelectedTaskAnnotations(routineId, taskId, dateStr, indicesToRemove) {
    var routine = allRoutines && allRoutines.find(function(r) { return r.id === routineId; });
    var task = routine && routine.tasks ? routine.tasks.find(function(t) { return t.id === taskId; }) : null;
    if (!task || !task.annotationsByDate || !task.annotationsByDate[dateStr]) return;
    var list = task.annotationsByDate[dateStr];
    var set = {};
    indicesToRemove.forEach(function(i) { set[i] = true; });
    var newList = list.filter(function(_, idx) { return !set[idx]; });
    if (newList.length === 0) delete task.annotationsByDate[dateStr];
    else task.annotationsByDate[dateStr] = newList;
    var storageKey = localStorage.getItem('token') ? 'routines' : 'localRoutines';
    try {
        var stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
        var ri = stored.findIndex(function(r) { return r.id === routineId; });
        if (ri !== -1 && stored[ri].tasks) {
            var ti = stored[ri].tasks.findIndex(function(t) { return t.id === taskId; });
            if (ti !== -1) {
                if (!stored[ri].tasks[ti].annotationsByDate) stored[ri].tasks[ti].annotationsByDate = {};
                if (newList.length === 0) delete stored[ri].tasks[ti].annotationsByDate[dateStr];
                else stored[ri].tasks[ti].annotationsByDate[dateStr] = newList;
                localStorage.setItem(storageKey, JSON.stringify(stored));
            }
        }
    } catch (_) {}
    var token = localStorage.getItem('token');
    if (token && typeof API_URL !== 'undefined') {
        fetch(API_URL + '/routines/' + routineId + '/tasks/' + taskId, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ text: task.text, completed: task.completed, annotationsByDate: task.annotationsByDate }) }).catch(function() {});
    }
}
function deleteTaskAnnotationsForDate(routineId, taskId, dateStr) {
    var routine = allRoutines && allRoutines.find(function(r) { return r.id === routineId; });
    var task = routine && routine.tasks ? routine.tasks.find(function(t) { return t.id === taskId; }) : null;
    if (!task || !task.annotationsByDate) return;
    delete task.annotationsByDate[dateStr];
    var storageKey = localStorage.getItem('token') ? 'routines' : 'localRoutines';
    try {
        var stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
        var ri = stored.findIndex(function(r) { return r.id === routineId; });
        if (ri !== -1 && stored[ri].tasks) {
            var ti = stored[ri].tasks.findIndex(function(t) { return t.id === taskId; });
            if (ti !== -1) {
                if (!stored[ri].tasks[ti].annotationsByDate) stored[ri].tasks[ti].annotationsByDate = {};
                delete stored[ri].tasks[ti].annotationsByDate[dateStr];
                localStorage.setItem(storageKey, JSON.stringify(stored));
            }
        }
    } catch (_) {}
    var token = localStorage.getItem('token');
    if (token && typeof API_URL !== 'undefined') {
        fetch(API_URL + '/routines/' + routineId + '/tasks/' + taskId, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ text: task.text, completed: task.completed, annotationsByDate: task.annotationsByDate }) }).catch(function() {});
    }
}

// Card de Agenda dedicado (sem heatmap): por rotina e dia
function createAgendaCard(routine, dateStr) {
    const iconName = getLucideIconName(routine.category?.icon);
    const timeLabel = routine.schedule?.time ? routine.schedule.time : '';
    let tasks = routine.tasks || [];
    if (tasks.length === 0) {
        tasks = [{ id: routine.id + '-new', text: routine.title || 'Rotina', _synthetic: true }];
    }
    let html = '<div class="agenda-card" data-routine-id="' + escapeHtml(routine.id) + '" data-agenda-date="' + escapeHtml(dateStr) + '">';
    html += '<div class="agenda-card-header">';
    html += '<span class="agenda-card-icon" title="' + escapeHtml(routine.category?.name || 'Rotina') + '"><i data-lucide="' + escapeHtml(iconName) + '"></i></span>';
    html += '<h3 class="agenda-card-title">' + escapeHtml(routine.title || 'Rotina') + '</h3>';
    if (timeLabel) html += '<span class="agenda-card-time">' + escapeHtml(timeLabel) + '</span>';
    html += '</div>';
    html += '<ul class="agenda-card-tasks">';
    tasks.forEach(task => {
        const ann = getTaskAnnotationForDate(task, dateStr);
        const hasAnnotation = ann && ann.type && (ann.data != null && ann.data !== '');
        const annotationsList = getTaskAnnotationsListForDate(task, dateStr);
        var taskLabel = annotationsList.length > 0 ? 'Anotações' : (task.text || '');
        html += '<li class="agenda-card-task-row">';
        html += '<div class="agenda-card-task-main">';
        html += '<span class="agenda-card-task-text">' + escapeHtml(taskLabel) + '</span>';
        html += '<span class="agenda-task-right">';
        html += '<button type="button" class="agenda-annotation-btn" data-routine-id="' + escapeHtml(routine.id) + '" data-task-id="' + escapeHtml(task.id) + '" data-annotation-date="' + escapeHtml(dateStr) + '" title="Anotar" aria-label="Anotar nesta tarefa"><i data-lucide="pencil" class="agenda-pencil-icon" aria-hidden="true"></i><span class="agenda-annotation-label">Anotar</span></button>';
        if (annotationsList.length > 0) {
            html += '<button type="button" class="agenda-task-menu-btn" data-routine-id="' + escapeHtml(routine.id) + '" data-task-id="' + escapeHtml(task.id) + '" data-annotation-date="' + escapeHtml(dateStr) + '" title="Menu" aria-label="Menu de anotações">⋮</button>';
        }
        html += '</span></div>';
        if (annotationsList.length > 0) {
            var sortedWithIdx = annotationsList.map(function(ann, idx) { return { ann: ann, idx: idx }; }).sort(function(a, b) {
                var ta = a.ann.lastUpdated ? new Date(a.ann.lastUpdated).getTime() : 0;
                var tb = b.ann.lastUpdated ? new Date(b.ann.lastUpdated).getTime() : 0;
                return ta - tb;
            });
            html += '<ul class="agenda-card-annotations">';
            sortedWithIdx.forEach(function(entry, i) {
                if (i > 0) html += '<li class="agenda-annotation-sep" role="presentation"><span class="agenda-annotation-sep-line"></span></li>';
                var annName = (entry.ann.name && String(entry.ann.name).trim()) ? String(entry.ann.name).trim() : (ANNOTATION_TYPE_NAMES[entry.ann.type] || entry.ann.type || 'Anotação');
                html += '<li class="agenda-card-annotation-item"><div class="agenda-annotation-folder-row"><div class="agenda-folder-bar"><button type="button" class="agenda-open-annotation" data-routine-id="' + escapeHtml(routine.id) + '" data-task-id="' + escapeHtml(task.id) + '" data-annotation-date="' + escapeHtml(dateStr) + '" data-annotation-index="' + entry.idx + '" title="Abrir anotação" aria-label="Abrir anotação"><i data-lucide="folder" class="agenda-folder-icon" aria-hidden="true"></i><span class="agenda-card-annotation-name">' + escapeHtml(annName) + '</span></button><span class="agenda-card-annotation-time" title="Horário">' + escapeHtml(formatAnnotationTime(entry.ann.lastUpdated)) + '</span></div></div></li>';
            });
            html += '</ul>';
        }
        html += '</li>';
    });
    html += '</ul></div>';
    return html;
}

// Criar HTML do card de rotina (options.agendaTasksHtml = bloco de tarefas com lápis para a view Agenda)
function createRoutineCard(routine, options) {
    const iconName = getLucideIconName(routine.category?.icon);
    const streak = getCurrentStreak(routine);
    const planType = routine.planType || 'daily';
    let planLabel = getPlanTypeLabel(planType);
    const s = routine.schedule || {};
    if (s.weekDays && s.weekDays.length) {
        const dayNames = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };
        planLabel += ' · ' + s.weekDays.sort((a, b) => a - b).map(d => dayNames[d]).join(', ');
    }
    if (planType === 'monthly' && s.monthlyType === 'dayOfMonth' && s.dayOfMonth) {
        planLabel += ' · Dia ' + s.dayOfMonth;
    }
    if (planType === 'monthly' && s.monthlyType === 'weekOfMonth') {
        const ord = s.weekOfMonth === 'last' ? 'últ.' : s.weekOfMonth + 'ª';
        const dayNames = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb' };
        planLabel += ' · ' + ord + ' ' + (dayNames[s.dayOfWeek] || '');
    }
    const allowedBulletTypes = ['reminder', 'task', 'commitment', 'important'];
    const bulletType = allowedBulletTypes.includes(routine.bulletType) ? routine.bulletType : 'task';

    return `
        <div class="routine-card-wrapper">
            <div class="routine-card" data-routine-id="${routine.id}">
                <div class="routine-card-content">
                    <div class="routine-card-bullet-row">
                        <span class="routine-card-bullet routine-card-bullet--${escapeHtml(bulletType)}" aria-hidden="true"></span>
                        <span class="routine-card-plan-badge" data-plan-type="${escapeHtml(planType)}">${escapeHtml(planLabel)}</span>
                    </div>
                    <div class="routine-card-header">
                        <span class="routine-card-icon" title="${escapeHtml(routine.category?.name || 'Rotina')}"><i data-lucide="${escapeHtml(iconName)}"></i></span>
                        <h3 class="routine-card-title">${escapeHtml(routine.title)}</h3>
                    </div>
                    ${routine.description ? `<p class="routine-card-description">${escapeHtml(routine.description)}</p>` : ''}
                    ${planType === 'daily' ? `<div class="routine-card-streak">
                        <span class="routine-card-streak-label">Sequência de dias</span>
                        <span class="routine-card-streak-number">${streak}</span>
                    </div>` : ''}
                    ${(options && options.agendaTasksHtml) ? options.agendaTasksHtml : ''}
                    <div class="routine-card-actions">
                        <button type="button" class="card-action-btn" data-edit-id="${routine.id}" title="Editar">✎</button>
                        ${typeof trashBinButtonHTML === 'function' ? trashBinButtonHTML({ className: 'card-action-btn delete', modifier: 'uiverse-trash-btn--card', dataAttrs: { 'data-delete-id': routine.id }, title: 'Excluir', ariaLabel: 'Excluir rotina' }) : `<button type="button" class="card-action-btn delete" data-delete-id="${routine.id}" title="Excluir">×</button>`}
                    </div>
                </div>
                <div class="routine-card-heatmap">
                    ${generateRoutineHeatmap(routine, heatmapOffsets[routine.id] ?? 0)}
                    <div class="heatmap-nav">
                        <button type="button" class="heatmap-nav-btn heatmap-prev" data-routine-id="${routine.id}" title="Mês anterior" aria-label="Mês anterior">‹</button>
                        <button type="button" class="heatmap-nav-btn heatmap-next" data-routine-id="${routine.id}" title="Próximo mês" aria-label="Próximo mês">›</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Atualizar heatmap de uma rotina após mudança de mês
async function updateHeatmapForRoutine(routineId, newOffset, fromButtonAnimation = false) {
    const OFFSET_MIN = -12;
    const OFFSET_MAX = 12;
    newOffset = Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, newOffset));
    heatmapOffsets[routineId] = newOffset;

    const routine = allRoutines.find(r => r.id === routineId);
    if (!routine) return;

    const card = document.querySelector(`[data-routine-id="${routineId}"]`);
    if (!card) return;

    const heatmapContainer = card.querySelector('.routine-card-heatmap');
    if (!heatmapContainer) return;

    const heatmapBlock = heatmapContainer.querySelector('.large-heatmap-block');
    if (heatmapBlock && !fromButtonAnimation) {
        heatmapBlock.classList.add('heatmap-updating');
        await new Promise(r => setTimeout(r, 100));
    }

    heatmapContainer.innerHTML = `
        ${generateRoutineHeatmap(routine, newOffset)}
        <div class="heatmap-nav">
            <button type="button" class="heatmap-nav-btn heatmap-prev" data-routine-id="${routineId}" title="Mês anterior" aria-label="Mês anterior">‹</button>
            <button type="button" class="heatmap-nav-btn heatmap-next" data-routine-id="${routineId}" title="Próximo mês" aria-label="Próximo mês">›</button>
        </div>
    `;
    const newBlock = heatmapContainer.querySelector('.large-heatmap-block');
    if (newBlock && !fromButtonAnimation) {
        newBlock.style.opacity = '0';
        newBlock.classList.add('heatmap-updating');
        requestAnimationFrame(() => {
            newBlock.style.opacity = '1';
            setTimeout(() => {
                newBlock.classList.remove('heatmap-updating');
                newBlock.style.opacity = '';
            }, 150);
        });
    }
    if (newBlock && fromButtonAnimation) {
        applyHeatmapInitialPosition(newBlock);
        newBlock.style.transform = 'scale(0.96)';
        newBlock.style.transformOrigin = 'center center';
        newBlock.style.opacity = '0.92';
        newBlock.style.transition = 'opacity 0.2s ease-out, transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)';
        requestAnimationFrame(() => {
            newBlock.style.opacity = '1';
            newBlock.style.transform = 'scale(1)';
            setTimeout(() => {
                newBlock.style.opacity = '';
                newBlock.style.transition = '';
                newBlock.style.transform = '';
                newBlock.style.transformOrigin = '';
            }, 300);
        });
    }
    attachHeatmapListeners(card, routine);
}

// Animação de arraste ao clicar em ‹ ou ›: desliza a faixa de meses e depois atualiza o conteúdo.
function animateHeatmapToMonth(routineId, routine, direction) {
    const card = document.querySelector(`[data-routine-id="${routineId}"]`);
    if (!card) {
        updateHeatmapForRoutine(routineId, (heatmapOffsets[routineId] ?? 0) + direction, true);
        return;
    }
    const heatmapContainer = card.querySelector('.routine-card-heatmap');
    const heatmapBlock = heatmapContainer?.querySelector('.large-heatmap-block');
    const container = heatmapBlock?.querySelector('.calendar-months-container');
    if (!container || container.children.length < 13) {
        updateHeatmapForRoutine(routineId, (heatmapOffsets[routineId] ?? 0) + direction, true);
        return;
    }
    const prevBtn = heatmapContainer.querySelector('.heatmap-prev');
    const nextBtn = heatmapContainer.querySelector('.heatmap-next');
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;

    const match = container.style.transform?.match(/translateX\(([^)]+)px\)/);
    const currentTranslateX = match ? parseFloat(match[1]) : 0;
    const monthWidth = container.offsetWidth / 13;
    const slotWidth = monthWidth + HEATMAP_GAP;
    const targetTranslateX = currentTranslateX - (direction * slotWidth);

    container.style.willChange = 'transform';
    container.style.transition = 'transform 0.6s cubic-bezier(0.45, 0, 0.55, 1)';
    container.style.transform = `translateX(${targetTranslateX}px)`;

    let handled = false;
    const onTransitionEnd = () => {
        if (handled) return;
        handled = true;
        container.style.willChange = '';
        container.removeEventListener('transitionend', onTransitionEnd);
        updateHeatmapForRoutine(routineId, (heatmapOffsets[routineId] ?? 0) + direction, true);
    };
    container.addEventListener('transitionend', onTransitionEnd, { once: true });
    setTimeout(() => {
        if (!handled) {
            handled = true;
            container.style.willChange = '';
            container.removeEventListener('transitionend', onTransitionEnd);
            updateHeatmapForRoutine(routineId, (heatmapOffsets[routineId] ?? 0) + direction, true);
        }
    }, 650);
}

// Aplicar posição inicial do heatmap (mês atual centralizado). Retorna true se aplicou, false se dimensões inválidas.
// Usa flag para aplicar apenas uma vez e evitar tremida por múltiplas reaplicações.
function applyHeatmapInitialPosition(heatmapBlock) {
    if (heatmapBlock.dataset.positionInitialized === 'true') return true;
    if (heatmapBlock.dataset.userHasDragged === '1') return true;
    const container = heatmapBlock.querySelector('.calendar-months-container');
    if (!container || container.children.length < 13) return false;
    const month6 = container.children[6];
    if (!month6) return false;
    // Forçar reflow
    heatmapBlock.offsetHeight;
    container.offsetHeight;
    // Usar getBoundingClientRect para posições reais (mais robusto que offsetWidth em flex/iframe)
    const heatmapRect = heatmapBlock.getBoundingClientRect();
    const month6Rect = month6.getBoundingClientRect();
    const viewportWidth = heatmapRect.width;
    if (viewportWidth <= 0) return false;
    const viewportCenterX = heatmapRect.left + viewportWidth / 2;
    const monthCenterX = month6Rect.left + month6Rect.width / 2;
    let translateX = viewportCenterX - monthCenterX;
    // Limites de arraste (usar offsetWidth se disponível, senão estimativa)
    const containerWidth = container.offsetWidth || container.getBoundingClientRect().width;
    const monthWidth = containerWidth > 0 ? containerWidth / 13 : 80;
    const slotWidth = monthWidth + HEATMAP_GAP;
    translateX = Math.max(-12 * slotWidth, Math.min(12 * slotWidth, translateX));
    container.style.transition = 'none';
    container.style.transform = `translateX(${translateX}px)`;
    updateCenteredMonth(heatmapBlock, translateX);
    heatmapBlock.dataset.positionInitialized = 'true';
    requestAnimationFrame(() => {
        container.style.transition = '';
    });
    return true;
}

// Polling até aplicar posição com sucesso (para preview Cursor, iframe, etc.)
function ensureHeatmapPositionWithRetry(heatmapBlock, maxAttempts = 60, intervalMs = 150) {
    let attempts = 0;
    const tryApply = () => {
        if (applyHeatmapInitialPosition(heatmapBlock)) return;
        attempts++;
        if (attempts < maxAttempts) {
            setTimeout(tryApply, intervalMs);
        }
    };
    // Aguardar 300ms antes da primeira tentativa (dar tempo ao layout)
    setTimeout(tryApply, 300);
}

// Reaplicar posição em todos os heatmaps visíveis (chamado após load e após renderRoutines)
function reapplyAllHeatmapPositions() {
    document.querySelectorAll('.large-heatmap-block').forEach(heatmapBlock => {
        applyHeatmapInitialPosition(heatmapBlock);
    });
}

// Atualizar qual mês é o "central" (sem blur) - usa getBoundingClientRect para precisão
function updateCenteredMonth(heatmapBlock, translateX) {
    const container = heatmapBlock.querySelector('.calendar-months-container');
    if (!container || container.children.length < 13) return;

    const viewportRect = heatmapBlock.getBoundingClientRect();
    const viewportCenterX = viewportRect.left + viewportRect.width / 2;
    let bestIdx = 6;
    let bestDist = Infinity;

    [...container.children].forEach((child, idx) => {
        const rect = child.getBoundingClientRect();
        const monthCenterX = rect.left + rect.width / 2;
        const dist = Math.abs(monthCenterX - viewportCenterX);
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = idx;
        }
    });

    [...container.children].forEach((child, idx) => {
        child.classList.toggle('calendar-month--current', idx === bestIdx);
    });
}

// Configurar arrastar/swipe no heatmap (13 meses em faixa, arrastar para mover)
const HEATMAP_GAP = 12;

function getHeatmapScrollRange(container, heatmapBlock) {
    if (!container) return 0;
    const viewportWidth = heatmapBlock.offsetWidth;
    const contentWidth = container.scrollWidth || container.offsetWidth;
    let scrollRange = contentWidth - viewportWidth;
    if (scrollRange <= 0) {
        const monthWidth = container.offsetWidth / 13;
        const slotWidth = monthWidth + HEATMAP_GAP;
        scrollRange = 12 * slotWidth;
    }
    return scrollRange;
}

function setupHeatmapDrag(heatmapBlock, routineId) {
    let startX = 0;
    let startTranslateX = 0;
    let isDragging = false;
    let hasMoved = false;

    const getX = (e) => (e.touches ? e.touches[0] : e.changedTouches ? e.changedTouches[0] : e).clientX;

    const onMove = (e) => {
        if (!isDragging) return;
        if (Math.abs(getX(e) - startX) > 5) hasMoved = true;
        if (e.cancelable) e.preventDefault();
        const container = heatmapBlock.querySelector('.calendar-months-container');
        if (!container) return;
        const scrollRange = getHeatmapScrollRange(container, heatmapBlock);
        const maxTranslateX = scrollRange;
        const minTranslateX = -scrollRange;
        const deltaX = getX(e) - startX;
        let translateX = startTranslateX + deltaX;
        translateX = Math.max(minTranslateX, Math.min(maxTranslateX, translateX));
        container.style.transform = `translateX(${translateX}px)`;
        updateCenteredMonth(heatmapBlock, translateX);
    };

    const onEnd = () => {
        if (!isDragging) return;
        const container = heatmapBlock.querySelector('.calendar-months-container');
        if (container) {
            const match = container.style.transform ? container.style.transform.match(/translateX\(([^)]+)px\)/) : null;
            const scrollRange = getHeatmapScrollRange(container, heatmapBlock);
            const minTranslateX = -scrollRange;
            const translateX = match ? parseFloat(match[1]) : minTranslateX / 2;
            updateCenteredMonth(heatmapBlock, translateX);
            container.style.transition = '';

            const minX = minTranslateX;
            const curOffset = heatmapOffsets[routineId] ?? 0;
            const viewportRect = heatmapBlock.getBoundingClientRect();
            const viewportCenterX = viewportRect.left + viewportRect.width / 2;
            let bestIdx = 6;
            let bestDist = Infinity;
            [...container.children].forEach((child, idx) => {
                const rect = child.getBoundingClientRect();
                const monthCenterX = rect.left + rect.width / 2;
                const dist = Math.abs(monthCenterX - viewportCenterX);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIdx = idx;
                }
            });
            if (translateX >= -10 && bestIdx <= 1 && curOffset > -12) {
                updateHeatmapForRoutine(routineId, curOffset - 1);
            } else if (translateX <= minX + 20 && bestIdx >= 11 && curOffset < 12) {
                updateHeatmapForRoutine(routineId, curOffset + 1);
            }
        }
        isDragging = false;
        if (hasMoved) heatmapBlock.dataset.justDragged = '1';
        setTimeout(() => delete heatmapBlock.dataset.justDragged, 50);
        hasMoved = false;
        heatmapBlock.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove, { passive: false });
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchend', onEnd);
    };

    const onStart = (e) => {
        if (e.cancelable && e.type === 'touchstart') e.preventDefault();
        hasMoved = false;
        heatmapBlock.dataset.userHasDragged = '1';
        startX = getX(e);
        const container = heatmapBlock.querySelector('.calendar-months-container');
        const monthWidth = container ? container.offsetWidth / 13 : 60;
        const slotWidth = monthWidth + HEATMAP_GAP;
        const match = container && container.style.transform ? container.style.transform.match(/translateX\(([^)]+)px\)/) : null;
        startTranslateX = match ? parseFloat(match[1]) : -(6 * slotWidth + monthWidth / 2);
        isDragging = true;
        heatmapBlock.classList.add('dragging');
        if (container) container.style.transition = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchend', onEnd, { passive: true });
    };

    heatmapBlock.addEventListener('mousedown', onStart);
    heatmapBlock.addEventListener('touchstart', onStart, { passive: false });
}

// Anexar listeners do heatmap (clique em dia → modal, arrastar para mover, botões mês anterior/próximo)
function attachHeatmapListeners(card, routine) {
    const cardHeatmap = card.querySelector('.routine-card-heatmap');
    if (!cardHeatmap) return;

    cardHeatmap.addEventListener('click', (e) => e.stopPropagation());

    const prevBtn = cardHeatmap.querySelector('.heatmap-prev');
    const nextBtn = cardHeatmap.querySelector('.heatmap-next');
    const updateNavButtons = () => {
        const cur = heatmapOffsets[routine.id] ?? 0;
        if (prevBtn) prevBtn.disabled = cur <= -12;
        if (nextBtn) nextBtn.disabled = cur >= 12;
    };
    updateNavButtons();
    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const cur = heatmapOffsets[routine.id] ?? 0;
            if (cur > -12) animateHeatmapToMonth(routine.id, routine, -1);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const cur = heatmapOffsets[routine.id] ?? 0;
            if (cur < 12) animateHeatmapToMonth(routine.id, routine, 1);
        });
    }

    const squares = cardHeatmap.querySelectorAll('.heatmap-square:not(.empty)');
    squares.forEach(square => {
        square.addEventListener('click', (e) => {
            e.stopPropagation();
            const block = square.closest('.large-heatmap-block');
            if (block?.dataset.justDragged) return;
            const date = square.getAttribute('data-date');
            const dateFormatted = square.getAttribute('data-date-formatted');
            if (date) showMonthAmplifiedModal(date, routine);
        });
    });

    const heatmapBlock = cardHeatmap.querySelector('.large-heatmap-block');
    if (heatmapBlock) {
        const container = heatmapBlock.querySelector('.calendar-months-container');
        if (container) {
            // ResizeObserver: aplicar posição quando o heatmap receber dimensões não-zero
            const resizeObserver = new ResizeObserver(() => {
                if (applyHeatmapInitialPosition(heatmapBlock)) {
                    resizeObserver.disconnect();
                }
            });
            resizeObserver.observe(heatmapBlock);

            // Tentativa inicial imediata
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    applyHeatmapInitialPosition(heatmapBlock);
                });
            });

            // Polling até sucesso (importante para Cursor preview e ambientes com layout tardio)
            ensureHeatmapPositionWithRetry(heatmapBlock);
        }
        setupHeatmapDrag(heatmapBlock, routine.id);
    }
}

// Criar card de adicionar rotina
function createAddRoutineCard() {
    return `
        <div class="add-routine-card" onclick="window.location.href='create.html'">
            <div class="add-routine-content">
                <div class="add-routine-icon">+</div>
                <div class="add-routine-text">Adicionar Rotina</div>
            </div>
        </div>
    `;
}

// Deletar rotina
async function deleteRoutine(routineId) {
    if (!confirm('Tem certeza que deseja excluir esta rotina?')) {
        return;
    }

    const token = localStorage.getItem('token');
    
    if (token) {
        try {
            await apiRequest(`/routines/${routineId}`, {
                method: 'DELETE'
            });
        } catch (error) {
            console.log('Servidor não disponível, removendo localmente');
        }
    }
    
    // Remover do localStorage
    let routines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
    routines = routines.filter(r => r.id !== routineId);
    routines = stripBase64FromRoutines(routines);
    localStorage.setItem('localRoutines', JSON.stringify(routines));
    
    // Recarregar rotinas
    await loadRoutines();
}

// Renderizar agenda: separação por dias (Hoje, Amanhã, ...) + cards dedicados sem heatmap
function renderAgenda() {
    const agendaView = document.getElementById('agendaView');
    if (!agendaView) return;
    const today = new Date();
    const todayStr = getLocalDateStr(today);
    const day = today.getDate();
    const month = MONTH_NAMES[today.getMonth()];
    const dayLabels = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };
    let html = '<div class="agenda-day-container">';
    html += '<div class="agenda-day-header">';
    html += '<h2 class="agenda-day-title">Agenda</h2>';
    html += '<p class="agenda-day-date">' + escapeHtml(day + ' de ' + month) + '</p>';
    html += '</div>';
    const numDays = 7;
    for (let i = 0; i < numDays; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const dateStr = getLocalDateStr(d);
        const routinesOnDay = (allRoutines || []).filter(r => isRoutineDate(dateStr, r));
        const sorted = routinesOnDay.slice().sort((a, b) => {
            const ta = a.schedule?.time || '99:99';
            const tb = b.schedule?.time || '99:99';
            return ta.localeCompare(tb);
        });
        let sectionLabel = '';
        if (i === 0) sectionLabel = 'Hoje';
        else if (i === 1) sectionLabel = 'Amanhã';
        else sectionLabel = dayLabels[d.getDay()] + ', ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()].slice(0, 3);
        html += '<section class="agenda-day-section" data-date="' + escapeHtml(dateStr) + '">';
        html += '<div class="agenda-day-section-head">';
        html += '<h3 class="agenda-day-section-title">' + escapeHtml(sectionLabel) + '</h3>';
        html += '</div>';
        if (sorted.length === 0) {
            html += '<p class="agenda-day-section-empty">Nenhuma rotina neste dia.</p>';
        } else {
            html += '<ul class="agenda-cards-list">';
            sorted.forEach(routine => {
                html += '<li>' + createAgendaCard(routine, dateStr) + '</li>';
            });
            html += '</ul>';
        }
        html += '</section>';
    }
    html += '</div>';
    agendaView.innerHTML = html;
    const lucideLib = typeof lucide !== 'undefined' ? lucide : (typeof Lucide !== 'undefined' ? Lucide : null);
    if (lucideLib && lucideLib.createIcons) lucideLib.createIcons();
}

// Biblioteca de Agendamentos: agendamentos passados (datas com anotações)
var BIBLIOTECA_EXCLUDED_KEY = 'bibliotecaExcluded';

function bibliotecaItemKey(routineId, taskId, dateStr, annName, lastUpdated) {
    var normalizedName = String(annName || '').trim().toLowerCase();
    var normalizedUpdated = String(lastUpdated || '').trim().toLowerCase();
    return String(routineId) + '|' + String(taskId) + '|' + String(dateStr) + '|' + normalizedName + '|' + normalizedUpdated;
}

function bibliotecaLegacyItemKey(routineId, taskId, dateStr, annIndex) {
    return String(routineId) + '|' + String(taskId) + '|' + String(dateStr) + '|' + String(annIndex);
}

function getBibliotecaExcluded() {
    try {
        return JSON.parse(localStorage.getItem(BIBLIOTECA_EXCLUDED_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function setBibliotecaExcluded(arr) {
    localStorage.setItem(BIBLIOTECA_EXCLUDED_KEY, JSON.stringify(arr));
}

function excludeFromBiblioteca(routineId, taskId, dateStr, annIndex, routineTitle, taskText, annName, lastUpdated) {
    var key = bibliotecaItemKey(routineId, taskId, dateStr, annName, lastUpdated);
    var list = getBibliotecaExcluded();
    if (list.some(function(x) { return x.key === key; })) return;
    list.push({ key: key, routineTitle: routineTitle || '', taskText: taskText || '', dateStr: dateStr || '', annName: annName || '', lastUpdated: lastUpdated || '' });
    setBibliotecaExcluded(list);
    if (typeof renderBiblioteca === 'function') renderBiblioteca();
}

function restoreToBiblioteca(key) {
    var list = getBibliotecaExcluded().filter(function(x) { return x.key !== key; });
    setBibliotecaExcluded(list);
    if (typeof renderBiblioteca === 'function') renderBiblioteca();
    var modal = document.getElementById('bibliotecaExcludedModal');
    if (list.length === 0 && modal) {
        modal.remove();
    } else if (modal) {
        showBibliotecaExcludedModal();
    }
}

function showBibliotecaExcludedModal() {
    var existing = document.getElementById('bibliotecaExcludedModal');
    if (existing) existing.remove();
    var list = getBibliotecaExcluded();
    var modal = document.createElement('div');
    modal.id = 'bibliotecaExcludedModal';
    modal.className = 'biblioteca-excluded-modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Arquivos excluídos da biblioteca');
    var html = '<div class="biblioteca-excluded-modal">';
    html += '<div class="biblioteca-excluded-header"><h3>Arquivos excluídos / antigos</h3><button type="button" class="biblioteca-excluded-close" aria-label="Fechar">×</button></div>';
    html += '<p class="biblioteca-excluded-desc">Itens que foram excluídos da biblioteca. Clique em Restaurar para devolvê-los à biblioteca.</p>';
    html += '<ul class="biblioteca-excluded-list">';
    if (list.length === 0) {
        html += '<li class="biblioteca-excluded-empty">Nenhum arquivo excluído.</li>';
    } else {
        list.forEach(function(entry) {
            var dateLabel = entry.dateStr;
            if (entry.dateStr && entry.dateStr.length >= 10) {
                var p = entry.dateStr.split('-');
                if (p.length >= 3) dateLabel = p[2] + ' ' + (MONTH_NAMES[parseInt(p[1], 10) - 1] || p[1]).slice(0, 3) + ' ' + p[0];
            }
            html += '<li class="biblioteca-excluded-item">';
            html += '<span class="biblioteca-excluded-name">' + escapeHtml(entry.annName || 'Anotação') + '</span>';
            html += '<span class="biblioteca-excluded-meta">' + escapeHtml(entry.routineTitle || '') + ' · ' + escapeHtml(entry.taskText || '') + ' · ' + escapeHtml(dateLabel) + '</span>';
            html += '<button type="button" class="biblioteca-excluded-restore" data-key="' + escapeHtml(entry.key) + '" title="Devolver à biblioteca">Restaurar</button>';
            html += '</li>';
        });
    }
    html += '</ul></div>';
    modal.innerHTML = html;
    modal.querySelector('.biblioteca-excluded-close').onclick = function() { modal.remove(); };
    modal.querySelectorAll('.biblioteca-excluded-restore').forEach(function(btn) {
        btn.onclick = function() { restoreToBiblioteca(btn.dataset.key); };
    });
    modal.onclick = function(e) {
        if (e.target === modal) modal.remove();
    };
    document.body.appendChild(modal);
}

function getPastAgendamentos() {
    var todayStr = getLocalDateStr(new Date());
    var list = [];
    (allRoutines || []).forEach(function(routine) {
        (routine.tasks || []).forEach(function(task) {
            var byDate = task.annotationsByDate;
            if (!byDate || typeof byDate !== 'object') return;
            Object.keys(byDate).forEach(function(dateStr) {
                var annotations = getTaskAnnotationsListForDate(task, dateStr);
                if (annotations && annotations.length > 0) {
                    list.push({ routine: routine, task: task, dateStr: dateStr, annotations: annotations });
                }
            });
        });
    });
    list.sort(function(a, b) { return b.dateStr.localeCompare(a.dateStr); });
    return list;
}

function renderBiblioteca() {
    var container = document.getElementById('bibliotecaView');
    if (!container) return;
    var all = getPastAgendamentos();
    var excludedSet = {};
    getBibliotecaExcluded().forEach(function(x) { excludedSet[x.key] = true; });
    var annotationTypeNames = { digitalizando: 'Digitalizando', caderno: 'Caderno', mental: 'Diagrama' };
    var html = '<div class="biblioteca-container">';
    html += '<div class="biblioteca-header">';
    html += '<h2 class="biblioteca-title">Biblioteca de Agendamentos</h2>';
    html += '<p class="biblioteca-desc">Agendamentos passados com anotações</p>';
    html += '<div class="biblioteca-header-actions">';
    html += typeof trashBinButtonHTML === 'function' ? trashBinButtonHTML({ id: 'bibliotecaBtnExclude', className: 'biblioteca-btn-exclude', labelText: 'Excluir', title: 'Selecionar itens para excluir da biblioteca', ariaLabel: 'Excluir da biblioteca' }) : '<button type="button" class="biblioteca-btn-exclude" id="bibliotecaBtnExclude" title="Selecionar itens para excluir da biblioteca" aria-label="Excluir da biblioteca">Excluir</button>';
    html += '<button type="button" class="biblioteca-btn-excluded" id="bibliotecaBtnExcluded" title="Arquivos excluídos ou antigos" aria-label="Ver arquivos excluídos"><i data-lucide="clock" class="biblioteca-clock-icon" aria-hidden="true"></i><span>Arquivos excluídos</span></button>';
    html += '</div></div>';
    var excludeMode = !!window._bibliotecaExcludeMode;
    if (excludeMode) {
        html += '<div class="biblioteca-selection-bar"><span class="biblioteca-selection-count" id="bibliotecaSelectionCount">0 selecionados</span><button type="button" class="biblioteca-btn-exclude-selected" id="bibliotecaBtnExcludeSelected">Excluir selecionados</button><button type="button" class="biblioteca-btn-cancel-exclude" id="bibliotecaBtnCancelExclude">Cancelar</button></div>';
    }
    if (all.length === 0) {
        html += '<p class="biblioteca-empty">Nenhum agendamento passado encontrado.</p>';
    } else {
        var byMonth = {};
        all.forEach(function(item) {
            var d = item.dateStr.split('-');
            var my = (d[0] || '') + '-' + (d[1] || '');
            if (!byMonth[my]) byMonth[my] = [];
            byMonth[my].push(item);
        });
        var sortedMonths = Object.keys(byMonth).sort().reverse();
        sortedMonths.forEach(function(my) {
            var parts = my.split('-');
            var monthLabel = (MONTH_NAMES[parseInt(parts[1], 10) - 1] || parts[1]) + ' ' + (parts[0] || '');
            html += '<section class="biblioteca-month-section" data-month="' + escapeHtml(my) + '">';
            html += '<h3 class="biblioteca-month-title">' + escapeHtml(monthLabel) + '</h3>';
            var byDay = {};
            byMonth[my].forEach(function(item) {
                var day = item.dateStr;
                if (!byDay[day]) byDay[day] = [];
                byDay[day].push(item);
            });
            var sortedDays = Object.keys(byDay).sort().reverse();
            sortedDays.forEach(function(dayStr) {
                var dayParts = dayStr.split('-');
                var dayDate = new Date(parseInt(dayParts[0], 10), parseInt(dayParts[1], 10) - 1, parseInt(dayParts[2], 10));
                var dayLabel = dayDate.getDate() + ' ' + (MONTH_NAMES[dayDate.getMonth()] || '').slice(0, 3);
                html += '<div class="biblioteca-day-block"><h4 class="biblioteca-day-title">' + escapeHtml(dayLabel) + '</h4>';
                var byType = {};
                byDay[dayStr].forEach(function(item) {
                    item.annotations.forEach(function(ann, annIdx) {
                        var t = ann.type || 'outro';
                        if (!byType[t]) byType[t] = [];
                        byType[t].push({ item: item, annIdx: annIdx, ann: ann });
                    });
                });
                var typeOrder = ['mental', 'caderno', 'digitalizando'];
                var renderedTypes = {};
                typeOrder.forEach(function(type) {
                    if (!byType[type] || byType[type].length === 0) return;
                    renderedTypes[type] = true;
                    var typeLabel = (annotationTypeNames[type] || type || 'Anotação').toUpperCase();
                    html += '<div class="biblioteca-type-block">';
                    html += '<h5 class="biblioteca-type-title">' + escapeHtml(typeLabel) + '</h5>';
                    html += '<ul class="biblioteca-list biblioteca-list-row">';
                    byType[type].forEach(function(entry) {
                        var item = entry.item, annIdx = entry.annIdx, ann = entry.ann;
                        var mainName = (ann.name && String(ann.name).trim()) ? String(ann.name).trim() : (annotationTypeNames[ann.type] || ann.type || 'Anotação');
                        var lastUpdated = ann.lastUpdated ? formatLastUpdate(ann.lastUpdated) : '';
                        if (!lastUpdated && item.dateStr) {
                            var p = item.dateStr.split('-');
                            if (p.length >= 3) lastUpdated = (new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10))).getDate() + ' ' + (MONTH_NAMES[parseInt(p[1], 10) - 1] || '').slice(0, 3);
                        }
                        if (!lastUpdated) lastUpdated = '—';
                        var key = bibliotecaItemKey(item.routine.id, item.task.id, item.dateStr, mainName, lastUpdated);
                        var legacyKey = bibliotecaLegacyItemKey(item.routine.id, item.task.id, item.dateStr, annIdx);
                        if (excludedSet[key] || excludedSet[legacyKey]) return;
                        html += '<li class="biblioteca-item biblioteca-item-row' + (excludeMode ? ' biblioteca-item-selectable' : '') + '">';
                        if (excludeMode) html += '<label class="biblioteca-item-checkbox-wrap"><input type="checkbox" class="biblioteca-exclude-checkbox" data-routine-id="' + escapeHtml(String(item.routine.id)) + '" data-task-id="' + escapeHtml(String(item.task.id)) + '" data-date-str="' + escapeHtml(item.dateStr) + '" data-annotation-index="' + annIdx + '" data-routine-title="' + escapeHtml(item.routine.title || '') + '" data-task-text="' + escapeHtml(item.task.text || '') + '" data-ann-name="' + escapeHtml(mainName) + '" data-last-updated="' + escapeHtml(lastUpdated) + '" data-ann-key="' + escapeHtml(key) + '"><span class="biblioteca-checkbox-label">Selecionar</span></label>';
                        html += '<div class="biblioteca-item-wrap">';
                        html += '<div class="biblioteca-folder-bar">';
                        html += '<button type="button" class="biblioteca-item-open" data-routine-id="' + escapeHtml(String(item.routine.id)) + '" data-task-id="' + escapeHtml(String(item.task.id)) + '" data-date-str="' + escapeHtml(item.dateStr) + '" data-annotation-index="' + annIdx + '" title="Abrir anotação" aria-label="' + escapeHtml('Abrir: ' + mainName + ' — ' + lastUpdated) + '"><i data-lucide="folder" class="biblioteca-item-folder-icon" aria-hidden="true"></i><span class="biblioteca-item-text-stack"><span class="biblioteca-item-name">' + escapeHtml(mainName) + '</span><span class="biblioteca-item-datetime">' + escapeHtml(lastUpdated) + '</span></span></button>';
                        html += '</div></div>';
                        if (item.task.bulletType === 'important') html += '<span class="biblioteca-item-important" title="Importante">!</span>';
                        html += '</li>';
                    });
                    html += '</ul></div>';
                });
                Object.keys(byType).forEach(function(type) {
                    if (renderedTypes[type]) return;
                    var typeLabel = (annotationTypeNames[type] || type || 'Anotação').toUpperCase();
                    html += '<div class="biblioteca-type-block">';
                    html += '<h5 class="biblioteca-type-title">' + escapeHtml(typeLabel) + '</h5>';
                    html += '<ul class="biblioteca-list biblioteca-list-row">';
                    byType[type].forEach(function(entry) {
                        var item = entry.item, annIdx = entry.annIdx, ann = entry.ann;
                        var mainName = (ann.name && String(ann.name).trim()) ? String(ann.name).trim() : (annotationTypeNames[ann.type] || ann.type || 'Anotação');
                        var lastUpdated = ann.lastUpdated ? formatLastUpdate(ann.lastUpdated) : '';
                        if (!lastUpdated && item.dateStr) {
                            var p = item.dateStr.split('-');
                            if (p.length >= 3) lastUpdated = (new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10))).getDate() + ' ' + (MONTH_NAMES[parseInt(p[1], 10) - 1] || '').slice(0, 3);
                        }
                        if (!lastUpdated) lastUpdated = '—';
                        var key = bibliotecaItemKey(item.routine.id, item.task.id, item.dateStr, mainName, lastUpdated);
                        var legacyKey = bibliotecaLegacyItemKey(item.routine.id, item.task.id, item.dateStr, annIdx);
                        if (excludedSet[key] || excludedSet[legacyKey]) return;
                        html += '<li class="biblioteca-item biblioteca-item-row' + (excludeMode ? ' biblioteca-item-selectable' : '') + '">';
                        if (excludeMode) html += '<label class="biblioteca-item-checkbox-wrap"><input type="checkbox" class="biblioteca-exclude-checkbox" data-routine-id="' + escapeHtml(String(item.routine.id)) + '" data-task-id="' + escapeHtml(String(item.task.id)) + '" data-date-str="' + escapeHtml(item.dateStr) + '" data-annotation-index="' + annIdx + '" data-routine-title="' + escapeHtml(item.routine.title || '') + '" data-task-text="' + escapeHtml(item.task.text || '') + '" data-ann-name="' + escapeHtml(mainName) + '" data-last-updated="' + escapeHtml(lastUpdated) + '" data-ann-key="' + escapeHtml(key) + '"><span class="biblioteca-checkbox-label">Selecionar</span></label>';
                        html += '<div class="biblioteca-item-wrap">';
                        html += '<div class="biblioteca-folder-bar">';
                        html += '<button type="button" class="biblioteca-item-open" data-routine-id="' + escapeHtml(String(item.routine.id)) + '" data-task-id="' + escapeHtml(String(item.task.id)) + '" data-date-str="' + escapeHtml(item.dateStr) + '" data-annotation-index="' + annIdx + '" title="Abrir anotação" aria-label="' + escapeHtml('Abrir: ' + mainName + ' — ' + lastUpdated) + '"><i data-lucide="folder" class="biblioteca-item-folder-icon" aria-hidden="true"></i><span class="biblioteca-item-text-stack"><span class="biblioteca-item-name">' + escapeHtml(mainName) + '</span><span class="biblioteca-item-datetime">' + escapeHtml(lastUpdated) + '</span></span></button>';
                        html += '</div></div>';
                        if (item.task.bulletType === 'important') html += '<span class="biblioteca-item-important" title="Importante">!</span>';
                        html += '</li>';
                    });
                    html += '</ul></div>';
                });
                html += '</div>';
            });
            html += '</section>';
        });
    }
    html += '</div>';
    container.innerHTML = html;
    // Limpa blocos vazios após aplicar exclusões:
    // se não houver itens, remove tipo -> dia -> mês.
    container.querySelectorAll('.biblioteca-type-block').forEach(function(typeBlock) {
        if (!typeBlock.querySelector('.biblioteca-item')) typeBlock.remove();
    });
    container.querySelectorAll('.biblioteca-day-block').forEach(function(dayBlock) {
        if (!dayBlock.querySelector('.biblioteca-item')) dayBlock.remove();
    });
    container.querySelectorAll('.biblioteca-month-section').forEach(function(monthBlock) {
        if (!monthBlock.querySelector('.biblioteca-day-block')) monthBlock.remove();
    });
    if (!container.querySelector('.biblioteca-item') && !container.querySelector('.biblioteca-empty')) {
        var emptyEl = document.createElement('p');
        emptyEl.className = 'biblioteca-empty';
        emptyEl.textContent = 'Nenhum agendamento passado encontrado.';
        var root = container.querySelector('.biblioteca-container');
        if (root) root.appendChild(emptyEl);
    }
    function openBibliotecaItem(routineId, taskId, dateStr, annIndex) {
        var all = getPastAgendamentos();
        var item = all.find(function(i) { return String(i.routine.id) === String(routineId) && String(i.task.id) === String(taskId) && i.dateStr === dateStr; });
        var idx = typeof annIndex === 'string' ? parseInt(annIndex, 10) : (annIndex || 0);
        if (isNaN(idx) || idx < 0) idx = 0;
        if (item && item.annotations && item.annotations.length > 0 && typeof openAnnotationViewer === 'function') {
            if (idx >= item.annotations.length) idx = item.annotations.length - 1;
            openAnnotationViewer(item, idx);
        }
    }
    container.querySelectorAll('.biblioteca-item-open').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            openBibliotecaItem(btn.dataset.routineId, btn.dataset.taskId, btn.dataset.dateStr, btn.dataset.annotationIndex);
        });
    });
    function updateBibliotecaSelectionCount() {
        var el = document.getElementById('bibliotecaSelectionCount');
        if (!el) return;
        var n = container.querySelectorAll('.biblioteca-exclude-checkbox:checked').length;
        el.textContent = n + ' selecionado' + (n !== 1 ? 's' : '');
    }
    container.querySelectorAll('.biblioteca-exclude-checkbox').forEach(function(cb) {
        cb.addEventListener('change', updateBibliotecaSelectionCount);
    });
    var btnExclude = document.getElementById('bibliotecaBtnExclude');
    if (btnExclude) btnExclude.addEventListener('click', function(e) {
        e.preventDefault();
        window._bibliotecaExcludeMode = true;
        if (typeof renderBiblioteca === 'function') renderBiblioteca();
    });
    var btnCancelExclude = document.getElementById('bibliotecaBtnCancelExclude');
    if (btnCancelExclude) btnCancelExclude.addEventListener('click', function(e) {
        e.preventDefault();
        window._bibliotecaExcludeMode = false;
        if (typeof renderBiblioteca === 'function') renderBiblioteca();
    });
    var btnExcludeSelected = document.getElementById('bibliotecaBtnExcludeSelected');
    if (btnExcludeSelected) btnExcludeSelected.addEventListener('click', function(e) {
        e.preventDefault();
        var checked = container.querySelectorAll('.biblioteca-exclude-checkbox:checked');
        var n = checked.length;
        if (n === 0) {
            alert('Selecione pelo menos um item para excluir.');
            return;
        }
        if (!confirm('Realmente deseja excluir os ' + n + ' item(ns) selecionado(s) da biblioteca?')) return;
        var list = getBibliotecaExcluded();
        checked.forEach(function(cb) {
            var key = cb.dataset.annKey || bibliotecaItemKey(cb.dataset.routineId, cb.dataset.taskId, cb.dataset.dateStr, cb.dataset.annName, cb.dataset.lastUpdated);
            if (list.some(function(x) { return x.key === key; })) return;
            list.push({ key: key, routineTitle: cb.dataset.routineTitle || '', taskText: cb.dataset.taskText || '', dateStr: cb.dataset.dateStr || '', annName: cb.dataset.annName || '', lastUpdated: cb.dataset.lastUpdated || '' });
        });
        setBibliotecaExcluded(list);
        window._bibliotecaExcludeMode = false;
        if (typeof renderBiblioteca === 'function') renderBiblioteca();
    });
    var btnExcluded = document.getElementById('bibliotecaBtnExcluded');
    if (btnExcluded) btnExcluded.addEventListener('click', function(e) { e.preventDefault(); showBibliotecaExcludedModal(); });
    var lucideLib = typeof lucide !== 'undefined' ? lucide : (typeof Lucide !== 'undefined' ? Lucide : null);
    if (lucideLib && lucideLib.createIcons) lucideLib.createIcons();
}

// Abrir anotação da Biblioteca em modo só leitura
function openAnnotationViewer(item, annIndex) {
    if (!item || !item.annotations || !item.annotations[annIndex]) return;
    var ann = item.annotations[annIndex];
    var taskCopy = Object.assign({}, item.task);
    taskCopy.annotationsByDate = {};
    taskCopy.annotationsByDate[item.dateStr] = [ann];
    annotationModalContext = {
        routineId: item.routine.id,
        taskId: item.task.id,
        task: taskCopy,
        type: ann.type,
        annotationDate: item.dateStr,
        viewOnly: true,
        viewItem: item,
        viewAnnIndex: annIndex
    };
    var modal = document.getElementById('annotationModal');
    var previewStep = document.getElementById('annotationPreviewStep');
    var editorStep = document.getElementById('annotationEditorStep');
    if (!modal || !editorStep) return;
    if (previewStep) previewStep.classList.add('hidden');
    editorStep.classList.remove('hidden');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('annotation-modal--view-only');
    document.body.classList.add('annotation-modal-open');
    var actions = modal.querySelector('.annotation-modal-actions');
    if (actions) {
        actions.querySelectorAll('.annotation-btn-cancel, .annotation-btn-save').forEach(function(b) { b.style.display = 'none'; });
        var closeViewBtn = document.getElementById('annotationBtnCloseView');
        if (closeViewBtn) { closeViewBtn.style.display = ''; closeViewBtn.onclick = function() { closeAnnotationViewer(); }; }
        var editViewBtn = document.getElementById('annotationBtnViewEdit');
        if (editViewBtn) {
            editViewBtn.style.display = '';
            editViewBtn.onclick = function() { switchAnnotationViewerToEdit(); };
        }
        var saveChangesBtn = document.getElementById('annotationBtnSaveChanges');
        if (saveChangesBtn) {
            saveChangesBtn.style.display = '';
            saveChangesBtn.onclick = function() {
                var sb = document.getElementById('annotationBtnSave');
                if (sb) sb.click();
            };
        }
    }
    var mentalToolbar = document.querySelector('.annotation-mental-toolbar');
    if (mentalToolbar) mentalToolbar.style.display = 'none';
    var digitalToolbar = document.querySelector('.annotation-digital-toolbar');
    if (digitalToolbar) digitalToolbar.style.display = 'none';
    var cadernoToolbar = document.querySelector('.annotation-caderno-toolbar');
    if (cadernoToolbar) cadernoToolbar.style.display = 'none';
    var digitalContent = document.getElementById('annotationDigitalContent');
    if (digitalContent) digitalContent.setAttribute('contenteditable', 'false');
    showAnnotationEditor(ann.type);
    if (ann.type === 'mental') {
        function doCenter() {
            if (typeof centerMentalViewOnContent === 'function') centerMentalViewOnContent();
        }
        requestAnimationFrame(function() {
            requestAnimationFrame(doCenter);
        });
        setTimeout(doCenter, 300);
        setTimeout(doCenter, 600);
    }
    var titleEl = document.getElementById('annotationEditorTitle');
    if (titleEl) titleEl.textContent = (item.task.text || 'Tarefa');
    var meta = document.getElementById('annotationModalActionsMeta');
    var downloadSlot = document.getElementById('annotationModalDownloadSlot');
    if (downloadSlot) downloadSlot.innerHTML = annotationModalSvgDownloadOnlyHtml(item.routine.id, item.task.id, item.dateStr, annIndex);
    if (meta) meta.setAttribute('aria-hidden', 'false');

    if (item.annotations.length > 1) {
        var nav = document.getElementById('annotationViewerNav');
        if (nav) {
            nav.style.display = 'flex';
            nav.innerHTML = '<span class="annotation-viewer-counter">' + (annIndex + 1) + ' / ' + item.annotations.length + '</span>' +
                '<button type="button" class="biblioteca-btn-nav" id="annotationViewerPrev">Anterior</button>' +
                '<button type="button" class="biblioteca-btn-nav" id="annotationViewerNext">Seguinte</button>';
            nav.querySelector('#annotationViewerPrev').onclick = function() {
                if (annIndex > 0) openAnnotationViewer(item, annIndex - 1);
            };
            nav.querySelector('#annotationViewerNext').onclick = function() {
                if (annIndex < item.annotations.length - 1) openAnnotationViewer(item, annIndex + 1);
            };
        }
    } else {
        var nav = document.getElementById('annotationViewerNav');
        if (nav) nav.style.display = 'none';
    }
}

function switchAnnotationViewerToEdit() {
    annotationModalContext.viewOnly = false;
    var modal = document.getElementById('annotationModal');
    if (modal) modal.classList.remove('annotation-modal--view-only');
    var downloadSlotEdit = document.getElementById('annotationModalDownloadSlot');
    if (downloadSlotEdit) downloadSlotEdit.innerHTML = '';
    var metaEdit = document.getElementById('annotationModalActionsMeta');
    if (metaEdit) metaEdit.setAttribute('aria-hidden', 'true');
    var actions = modal && modal.querySelector('.annotation-modal-actions');
    if (actions) {
        actions.querySelectorAll('.annotation-btn-cancel, .annotation-btn-save').forEach(function(b) { b.style.display = ''; });
        var closeViewBtn = document.getElementById('annotationBtnCloseView');
        if (closeViewBtn) closeViewBtn.style.display = 'none';
        var editViewBtn = document.getElementById('annotationBtnViewEdit');
        if (editViewBtn) editViewBtn.style.display = 'none';
        var saveChangesBtn = document.getElementById('annotationBtnSaveChanges');
        if (saveChangesBtn) saveChangesBtn.style.display = 'none';
    }
    var mentalToolbar = document.querySelector('.annotation-mental-toolbar');
    if (mentalToolbar) mentalToolbar.style.display = '';
    var digitalToolbar = document.querySelector('.annotation-digital-toolbar');
    if (digitalToolbar) digitalToolbar.style.display = '';
    var cadernoToolbar = document.querySelector('.annotation-caderno-toolbar');
    if (cadernoToolbar) cadernoToolbar.style.display = '';
    var digitalContent = document.getElementById('annotationDigitalContent');
    if (digitalContent) digitalContent.setAttribute('contenteditable', 'true');
}

function closeAnnotationViewer() {
    var modal = document.getElementById('annotationModal');
    if (modal) modal.classList.remove('annotation-modal--view-only');
    var actions = modal && modal.querySelector('.annotation-modal-actions');
    if (actions) {
        actions.querySelectorAll('.annotation-btn-cancel, .annotation-btn-save').forEach(function(b) { b.style.display = ''; });
        var closeViewBtn = document.getElementById('annotationBtnCloseView');
        if (closeViewBtn) closeViewBtn.style.display = 'none';
        var editViewBtn = document.getElementById('annotationBtnViewEdit');
        if (editViewBtn) editViewBtn.style.display = 'none';
        var saveChangesBtn = document.getElementById('annotationBtnSaveChanges');
        if (saveChangesBtn) saveChangesBtn.style.display = 'none';
    }
    var mentalToolbar = document.querySelector('.annotation-mental-toolbar');
    if (mentalToolbar) mentalToolbar.style.display = '';
    var digitalToolbar = document.querySelector('.annotation-digital-toolbar');
    if (digitalToolbar) digitalToolbar.style.display = '';
    var cadernoToolbar = document.querySelector('.annotation-caderno-toolbar');
    if (cadernoToolbar) cadernoToolbar.style.display = '';
    var digitalContent = document.getElementById('annotationDigitalContent');
    if (digitalContent) digitalContent.setAttribute('contenteditable', 'true');
    annotationModalContext = { routineId: null, taskId: null, task: null, type: null, annotationDate: null };
    closeAnnotationModal();
}

// Renderizar calendário
function renderCalendar() {
    const calendarView = document.getElementById('calendarView');
    // Implementação simples de calendário
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    let calendarHTML = '<div class="calendar-container">';
    calendarHTML += `<h3 class="calendar-title">${firstDay.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h3>`;
    calendarHTML += '<div class="calendar-grid">';
    
    // Dias da semana
    const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    weekDays.forEach(day => {
        calendarHTML += `<div class="calendar-day-header">${day}</div>`;
    });
    
    // Espaços vazios antes do primeiro dia
    for (let i = 0; i < startingDayOfWeek; i++) {
        calendarHTML += '<div class="calendar-day empty"></div>';
    }
    
    const allowedBulletTypes = ['reminder', 'task', 'commitment', 'important'];
    // Dias do mês
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const routinesOnDay = allRoutines.filter(r => isRoutineDate(dateStr, r));
        const bulletType = (r) => allowedBulletTypes.includes(r.bulletType) ? r.bulletType : 'task';
        const doneForDay = (r) => getRoutineCompletedDates(r).has(dateStr);
        const allDoneToday = routinesOnDay.length > 0 && routinesOnDay.every(doneForDay);
        const someDoneToday = routinesOnDay.some(doneForDay);
        const tasksHTML = routinesOnDay.length > 0
            ? '<div class="calendar-day-tasks">' + routinesOnDay.map(r => {
                const done = doneForDay(r);
                return `<div class="calendar-day-task-row${done ? ' calendar-day-task-row--done' : ''}"><span class="routine-card-bullet routine-card-bullet--${escapeHtml(bulletType(r))}" aria-hidden="true"></span><span class="calendar-day-task-name" title="${escapeHtml(r.title || '')}">${escapeHtml(r.title || 'tarefa')}</span></div>`;
            }).join('') + '</div>'
            : '';
        let dayStateClass = '';
        if (routinesOnDay.length > 0) {
            dayStateClass = allDoneToday ? ' calendar-day--all-done' : (someDoneToday ? ' calendar-day--partial-done' : '');
        }
        calendarHTML += `<div class="calendar-day ${routinesOnDay.length > 0 ? 'has-routines' : ''}${dayStateClass}">`;
        calendarHTML += `<span class="day-number">${day}</span>`;
        calendarHTML += tasksHTML;
        calendarHTML += '</div>';
    }
    
    calendarHTML += '</div></div>';
    calendarView.innerHTML = calendarHTML;
}

// Função auxiliar para escapar HTML (segura para null/undefined)
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// ==================== MODAL DE ANOTAÇÃO ====================
let annotationModalContext = { routineId: null, taskId: null, task: null, type: null, annotationDate: null };

function openAnnotationModal(routineId, taskId, task, annotationDate) {
    const dateStr = annotationDate || getLocalDateStr(new Date());
    annotationModalContext = { routineId, taskId, task, type: null, annotationDate: dateStr, startBlank: true };
    const modal = document.getElementById('annotationModal');
    const previewStep = document.getElementById('annotationPreviewStep');
    const editorStep = document.getElementById('annotationEditorStep');
    const previewTitle = document.getElementById('annotationPreviewTitle');
    if (previewTitle) {
        const d = new Date(dateStr + 'T12:00:00');
        previewTitle.textContent = 'Anotação para ' + d.getDate() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    }
    if (!modal || !previewStep || !editorStep) return;
    previewStep.classList.remove('hidden');
    editorStep.classList.add('hidden');
    document.getElementById('annotationEditorDigitalizing').classList.add('hidden');
    document.getElementById('annotationEditorCaderno').classList.add('hidden');
    document.getElementById('annotationEditorMental').classList.add('hidden');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('annotation-modal-open');
    // Garantir que os 3 cards abram o editor ao clicar (bind direto ao abrir o modal)
    modal.querySelectorAll('.annotation-preview-card').forEach(function(btn) {
        btn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            var type = (btn.dataset && btn.dataset.type) ? String(btn.dataset.type).trim() : '';
            if (type && typeof showAnnotationEditor === 'function') showAnnotationEditor(type);
        };
    });
}

function showSavedMessage(isToday) {
    const container = document.getElementById('notificationContainer');
    if (!container) return;
    const text = isToday
        ? 'Salvo! Este agendamento aparecerá na Biblioteca a partir de amanhã.'
        : 'Salvo!';
    const el = document.createElement('div');
    el.className = 'saved-toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    container.appendChild(el);
    setTimeout(function() {
        el.classList.add('saved-toast-out');
        setTimeout(function() {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
    }, 2500);
}

function closeAnnotationModal() {
    if (typeof hideMentalAddPreview === 'function') hideMentalAddPreview();
    document.body.classList.remove('annotation-modal-open');
    hideMentalTextConfigToolbarAndSpacing();
    hideAnnotationSavingOverlay();
    const modal = document.getElementById('annotationModal');
    if (modal) {
        /* Evita aviso do Chrome: aria-hidden com descendente focado */
        if (typeof document.activeElement !== 'undefined' && modal.contains(document.activeElement)) {
            try { document.activeElement.blur(); } catch (_) {}
        }
        modal.classList.remove('annotation-modal--mental', 'annotation-modal--caderno', 'annotation-modal--digitalizando', 'annotation-modal--view-only');
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        var actions = modal.querySelector('.annotation-modal-actions');
        if (actions) {
            actions.querySelectorAll('.annotation-btn-cancel, .annotation-btn-save').forEach(function(b) { b.style.display = ''; });
            var closeViewBtn = document.getElementById('annotationBtnCloseView');
            if (closeViewBtn) closeViewBtn.style.display = 'none';
        }
        var mentalToolbar = document.querySelector('.annotation-mental-toolbar');
        if (mentalToolbar) mentalToolbar.style.display = '';
        var digitalToolbar = document.querySelector('.annotation-digital-toolbar');
        if (digitalToolbar) digitalToolbar.style.display = '';
        var cadernoToolbar = document.querySelector('.annotation-caderno-toolbar');
        if (cadernoToolbar) cadernoToolbar.style.display = '';
        var digitalContent = document.getElementById('annotationDigitalContent');
        if (digitalContent) digitalContent.setAttribute('contenteditable', 'true');
        var editViewBtn = document.getElementById('annotationBtnViewEdit');
        if (editViewBtn) editViewBtn.style.display = 'none';
        var saveChangesBtn = document.getElementById('annotationBtnSaveChanges');
        if (saveChangesBtn) saveChangesBtn.style.display = 'none';
        var downloadSlot = document.getElementById('annotationModalDownloadSlot');
        if (downloadSlot) downloadSlot.innerHTML = '';
        var meta = document.getElementById('annotationModalActionsMeta');
        if (meta) meta.setAttribute('aria-hidden', 'true');
    }
    annotationModalContext = { routineId: null, taskId: null, task: null, type: null, annotationDate: null };
}

function showAnnotationEditor(type) {
    if (!type) return;
    annotationModalContext.type = type;
    const previewStep = document.getElementById('annotationPreviewStep');
    const editorStep = document.getElementById('annotationEditorStep');
    const titleEl = document.getElementById('annotationEditorTitle');
    if (!editorStep) return;
    if (previewStep) previewStep.classList.add('hidden');
    editorStep.classList.remove('hidden');
    var taskName = (annotationModalContext.task && annotationModalContext.task.text) ? String(annotationModalContext.task.text).trim() : 'Tarefa';
    if (titleEl) {
        if (type === 'mental') titleEl.textContent = 'Diagrama - ' + taskName;
        else titleEl.textContent = ({ digitalizando: 'Digitalizando', caderno: 'Caderno Digital' }[type] || 'Editor');
    }
    const digitalizingPanel = document.getElementById('annotationEditorDigitalizing');
    const cadernoPanel = document.getElementById('annotationEditorCaderno');
    const mentalPanel = document.getElementById('annotationEditorMental');
    if (digitalizingPanel) digitalizingPanel.classList.toggle('hidden', type !== 'digitalizando');
    if (cadernoPanel) cadernoPanel.classList.toggle('hidden', type !== 'caderno');
    if (mentalPanel) mentalPanel.classList.toggle('hidden', type !== 'mental');
    const modal = document.getElementById('annotationModal');
    if (modal) {
        modal.classList.remove('annotation-modal--mental', 'annotation-modal--caderno', 'annotation-modal--digitalizando');
        if (type === 'mental') modal.classList.add('annotation-modal--mental');
        else if (type === 'caderno') modal.classList.add('annotation-modal--caderno');
        else if (type === 'digitalizando') modal.classList.add('annotation-modal--digitalizando');
    }
    if (type === 'digitalizando') {
        initAnnotationDigitalizing();
        requestAnimationFrame(function() {
            var digitalContent = document.getElementById('annotationDigitalContent');
            if (digitalContent) {
                digitalContent.scrollTop = 0;
                digitalContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    } else if (type === 'caderno') {
        initAnnotationCaderno();
        requestAnimationFrame(function() {
            var cadernoBg = document.querySelector('.annotation-caderno-bg');
            if (cadernoBg) cadernoBg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    } else if (type === 'mental') {
        initAnnotationMental();
        requestAnimationFrame(function() {
            var c = document.getElementById('annotationMentalCenter');
            if (c && window._annotationMentalData) {
                var cn = window._annotationMentalData.nodes && window._annotationMentalData.nodes.find(function(n) { return n.id === 'center'; });
                if (cn) {
                    var cx = typeof cn.x === 'number' ? cn.x : 150;
                    var cy = typeof cn.y === 'number' ? cn.y : 80;
                    c.style.position = 'absolute';
                    c.style.left = cx + 'px';
                    c.style.top = cy + 'px';
                    c.style.transform = 'none';
                }
            }
            if (mentalPanel) mentalPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            requestAnimationFrame(function() {
                if (typeof centerMentalViewOnContent === 'function') centerMentalViewOnContent();
            });
        });
    }
}

function initAnnotationDigitalizing() {
    const el = document.getElementById('annotationDigitalContent');
    if (!el) return;
    const task = annotationModalContext.task;
    const dateStr = annotationModalContext.annotationDate;
    if (annotationModalContext.startBlank) {
        el.innerHTML = '';
        return;
    }
    const annObj = getTaskAnnotationForDate(task, dateStr);
    const ann = annObj && annObj.type === 'digitalizando' && annObj.data != null
        ? annObj.data
        : (task && task.text ? escapeHtml(task.text) : '');
    el.innerHTML = ann;
}

function initAnnotationCaderno() {
    const canvas = document.getElementById('annotationCadernoCanvas');
    if (!canvas) return;
    const task = annotationModalContext.task;
    const container = canvas.closest('.annotation-caderno-bg');
    const cw = container ? container.clientWidth : 500;
    const ch = container ? Math.max(300, container.clientHeight) : 400;
    const w = cw > 0 ? cw : 500;
    const h = ch > 0 ? ch : 400;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const lineSpacing = 24;
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let y = lineSpacing; y < h; y += lineSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }
    let imgData = null;
    const dateStr = annotationModalContext.annotationDate;
    if (!annotationModalContext.startBlank) {
        const annObj = getTaskAnnotationForDate(task, dateStr);
        if (annObj && annObj.type === 'caderno' && annObj.data) {
            const img = new Image();
            img.onload = function() { ctx.drawImage(img, 0, 0); };
            img.src = annObj.data;
        }
    }
    if (annotationModalContext.viewOnly) {
        window._annotationCadernoCtx = ctx;
        window._annotationCadernoCanvas = canvas;
        return;
    }
    let isDrawing = false;
    let lastX = 0, lastY = 0;
    const colorInput = document.getElementById('annotationCadernoColor');
    const toolBtns = document.querySelectorAll('.annotation-caderno-tool');
    toolBtns.forEach(b => {
        b.classList.remove('active');
        if (b.dataset.tool === 'pen') b.classList.add('active');
    });
    let currentTool = 'pen';
    let currentLineWidth = 3;
    document.querySelectorAll('.annotation-caderno-tool').forEach(btn => {
        btn.onclick = function() {
            document.querySelectorAll('.annotation-caderno-tool').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTool = btn.dataset.tool || 'pen';
        };
    });
    document.querySelectorAll('.annotation-caderno-width').forEach(btn => {
        btn.onclick = function() {
            document.querySelectorAll('.annotation-caderno-width').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentLineWidth = parseInt(btn.dataset.width, 10) || 3;
        };
    });
    function getColor() { return (colorInput && colorInput.value) || '#000000'; }
    function draw(x1, y1, x2, y2) {
        if (currentTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 20;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = getColor();
            ctx.lineWidth = currentLineWidth;
        }
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }
    canvas.onmousedown = function(e) {
        if (e.button !== 0) return;
        const r = canvas.getBoundingClientRect();
        const x = (e.clientX - r.left) * (canvas.width / r.width);
        const y = (e.clientY - r.top) * (canvas.height / r.height);
        isDrawing = true;
        lastX = x;
        lastY = y;
    };
    canvas.onmousemove = function(e) {
        if (!isDrawing) return;
        const r = canvas.getBoundingClientRect();
        const x = (e.clientX - r.left) * (canvas.width / r.width);
        const y = (e.clientY - r.top) * (canvas.height / r.height);
        draw(lastX, lastY, x, y);
        lastX = x;
        lastY = y;
    };
    canvas.onmouseup = canvas.onmouseleave = function() { isDrawing = false; };
    window._annotationCadernoCtx = ctx;
    window._annotationCadernoCanvas = canvas;
}

function initAnnotationMental() {
    const centerEl = document.getElementById('annotationMentalCenter');
    const branchesEl = document.getElementById('annotationMentalBranches');
    if (!centerEl || !branchesEl) return;
    const task = annotationModalContext.task;
    const dateStr = annotationModalContext.annotationDate;
    centerEl.textContent = task && task.text ? task.text : 'Tarefa';
    let data = { nodes: [{ id: 'center', label: (task && task.text) || 'Tarefa', x: 150, y: 80 }], edges: [] };
    if (!annotationModalContext.startBlank) {
        const annObj = getTaskAnnotationForDate(task, dateStr);
        if (annObj && annObj.type === 'mental' && annObj.data) {
            try {
                const parsed = typeof annObj.data === 'string' ? JSON.parse(annObj.data) : annObj.data;
                if (parsed && parsed.nodes) {
                    data = parsed;
                    if (!data.edges) data.edges = [];
                    data.edges.forEach(function(e) { if (!e.type) e.type = 'hierarchical'; });
                }
            } catch (_) {}
        }
    }
    var centerNode = data.nodes.find(function (n) { return n.id === 'center'; });
    if (centerNode) {
        var cx = typeof centerNode.x === 'number' ? centerNode.x : 150;
        var cy = typeof centerNode.y === 'number' ? centerNode.y : 80;
        centerNode.x = cx;
        centerNode.y = cy;
        centerEl.style.position = 'absolute';
        centerEl.style.left = cx + 'px';
        centerEl.style.top = cy + 'px';
        centerEl.style.transform = 'none';
    }
    branchesEl.innerHTML = '';
    data.nodes.forEach((n) => {
        if (n.id === 'center') return;
        const div = createMentalBranchNode(n, branchesEl);
        branchesEl.appendChild(div);
    });
    window._annotationMentalData = data;
    let nextNum = 1;
    data.nodes.forEach(n => {
        if (n.id && n.id !== 'center' && typeof n.id === 'string' && n.id.match(/^b\d+$/)) {
            const num = parseInt(n.id.slice(1), 10);
            if (!isNaN(num)) nextNum = Math.max(nextNum, num + 1);
        }
    });
    window._annotationMentalNextId = nextNum;
    var canvasEl = document.getElementById('annotationMentalCanvas');
    var wrapEl = document.getElementById('annotationMentalZoomWrap');
    var insertParent = wrapEl || canvasEl;
    if (insertParent && !document.getElementById('annotationMentalConnections')) {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'annotationMentalConnections';
        svg.className = 'annotation-mental-connections';
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        insertParent.insertBefore(svg, insertParent.firstChild);
    }
    window._annotationMentalPan = window._annotationMentalPan || { x: 0, y: 0 };
    window._annotationMentalSelectedIds = window._annotationMentalSelectedIds || [];
    window._annotationMentalConnectionSourceId = null;
    setMentalZoom(1);
    setupMentalZoomControls();
    setupMentalPan();
    setupMentalConnectionMode();
    if (!document.body.dataset.mentalImagePasteSetup) {
        document.body.dataset.mentalImagePasteSetup = '1';
        setupMentalBranchImagePasteAndDrop();
    }
    setupMentalSelection();
    setupMentalKeyboard();
    if (typeof drawMentalConnections === 'function') drawMentalConnections();
    if (annotationModalContext.viewOnly && typeof centerMentalViewOnContent === 'function') {
        setTimeout(centerMentalViewOnContent, 50);
        requestAnimationFrame(function() { requestAnimationFrame(centerMentalViewOnContent); });
    }
}

/** Mostra a barra de configuração de texto (I, U, S, etc.) que fica abaixo do botão T no diagrama. Não move a barra. */
function openMentalTextConfigToolbar(targetEl) {
    var toolbar = document.getElementById('annotationMentalTextConfigToolbar');
    if (!toolbar) return;
    toolbar.classList.remove('hidden');
    window._annotationMentalTextConfigTarget = targetEl || null;

    // Posicionar "na lateral" do elemento pedido (TÍTULO / DESCRIÇÃO)
    if (targetEl && typeof targetEl.getBoundingClientRect === 'function') {
        try {
            var rect = targetEl.getBoundingClientRect();
            var tw = toolbar.getBoundingClientRect().width;
            var th = toolbar.getBoundingClientRect().height;

            // Preferir à esquerda; se sair da tela, usar à direita
            var left = rect.left - tw - 12;
            if (left < 8) left = rect.right + 12;
            if (left + tw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - tw - 8);

            var top = rect.top;
            if (top < 8) top = 8;
            if (top + th > window.innerHeight - 8) top = Math.max(8, window.innerHeight - th - 8);

            toolbar.style.position = 'fixed';
            toolbar.style.left = left + 'px';
            toolbar.style.top = top + 'px';
            toolbar.style.zIndex = '9999';
        } catch (_) {}
    }
}

function hideMentalTextConfigToolbarAndSpacing() {
    var toolbar = document.getElementById('annotationMentalTextConfigToolbar');
    if (toolbar) toolbar.classList.add('hidden');
    var panel = document.getElementById('annotationMentalTextSpacingPanel');
    if (panel) panel.classList.add('hidden');
    window._annotationMentalTextConfigTarget = null;
}

function setupMentalTextConfigOutsideClickClose() {
    if (document.body.dataset.mentalTextUiOutsideBound) return;
    document.body.dataset.mentalTextUiOutsideBound = '1';
    document.addEventListener('click', function(e) {
        var modal = document.getElementById('annotationModal');
        if (!modal || modal.classList.contains('hidden') || !modal.classList.contains('annotation-modal--mental')) return;

        var toolbar = document.getElementById('annotationMentalTextConfigToolbar');
        var spacingPanel = document.getElementById('annotationMentalTextSpacingPanel');
        if (!toolbar && !spacingPanel) return;

        var clickedToolbar = e.target.closest && (e.target.closest('#annotationMentalTextConfigToolbar'));
        var clickedSpacingPanel = e.target.closest && (e.target.closest('#annotationMentalTextSpacingPanel'));
        var clickedTextConfigBtn = e.target.closest && e.target.closest('.annotation-mental-text-config-btn');
        var clickedSpacingBtn = e.target.closest && e.target.closest('.annotation-mental-text-config-spacing');
        var clickedBranchMenu = e.target.closest && (e.target.closest('.annotation-mental-dropdown') || e.target.closest('.annotation-mental-menu-trigger'));

        if (clickedToolbar || clickedSpacingPanel || clickedTextConfigBtn || clickedSpacingBtn || clickedBranchMenu) return;

        var target = window._annotationMentalTextConfigTarget;
        if (target && target.contains && target.contains(e.target)) return;
        if (target && e.target === target) return;

        hideMentalTextConfigToolbarAndSpacing();
    }, true);
}

function showMentalTextSpacingPanel(targetEl) {
    var panel = document.getElementById('annotationMentalTextSpacingPanel');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.style.display = '';

    if (targetEl) window._annotationMentalTextConfigTarget = targetEl;
    var target = targetEl || window._annotationMentalTextConfigTarget || document.activeElement;
    if (!target) return;

    var range = document.getElementById('annotationMentalTextSpacingRange');
    var valueEl = document.getElementById('annotationMentalTextSpacingValue');
    if (!range || !valueEl) return;

    function parseEmFromStylePxOrEm(v) {
        if (!v || typeof v !== 'string') return NaN;
        var s = v.trim();
        var num = parseFloat(s);
        if (isNaN(num)) return NaN;
        if (s.endsWith('em')) return num;
        if (s.endsWith('px')) return num / 16;
        // fallback: assume em
        return num;
    }

    function computePercentFromTarget(el) {
        // Prefer letter-spacing
        var ls = (el.style && el.style.letterSpacing) ? el.style.letterSpacing : '';
        var lsEm = parseEmFromStylePxOrEm(ls);
        if (!isNaN(lsEm)) {
            // mapping: 0..100 => 0..0.25em
            var p = (lsEm / 0.25) * 100;
            if (isFinite(p)) return Math.max(0, Math.min(100, Math.round(p)));
        }
        var lh = (el.style && el.style.lineHeight) ? el.style.lineHeight : '';
        var lhNum = parseFloat(lh);
        if (!isNaN(lhNum)) {
            // mapping: 0..100 => 1..2.2
            var p2 = ((lhNum - 1) / 1.2) * 100;
            if (isFinite(p2)) return Math.max(0, Math.min(100, Math.round(p2)));
        }
        return parseInt(range.value || '50', 10) || 50;
    }

    function applySpacingToTarget(el, percent) {
        if (!el || !el.style) return;
        var p01 = Math.max(0, Math.min(100, percent)) / 100;
        // 0..100 => letterSpacing 0..0.25em
        var letter = p01 * 0.25;
        // 0..100 => line-height 1..2.2
        var lineHeight = 1 + p01 * 1.2;
        // 0..100 => indent 0..0.8em (visual "recuo")
        var indent = p01 * 0.8;
        el.style.letterSpacing = letter + 'em';
        el.style.lineHeight = String(lineHeight);
        el.style.textIndent = indent + 'em';

        // UI
        valueEl.textContent = Math.round(percent) + '%';
    }

    // Position panel close to target (side), similar to toolbar positioning
    try {
        var rect = targetEl && typeof targetEl.getBoundingClientRect === 'function' ? targetEl.getBoundingClientRect() : null;
        var pRect = panel.getBoundingClientRect();
        if (rect && pRect) {
            var desiredLeft = rect.left - pRect.width - 12;
            if (desiredLeft < 8) desiredLeft = rect.right + 12;
            desiredLeft = Math.max(8, Math.min(desiredLeft, window.innerWidth - pRect.width - 8));
            var desiredTop = rect.top;
            var tb = document.getElementById('annotationMentalTextConfigToolbar');
            if (tb && !tb.classList.contains('hidden') && typeof tb.getBoundingClientRect === 'function') {
                desiredTop = rect.top + tb.getBoundingClientRect().height + 8;
            }
            desiredTop = Math.max(8, Math.min(desiredTop, window.innerHeight - pRect.height - 8));
            panel.style.position = 'fixed';
            panel.style.left = desiredLeft + 'px';
            panel.style.top = desiredTop + 'px';
            panel.style.zIndex = '9999';
        }
    } catch (_) {}

    var initial = computePercentFromTarget(target);
    range.value = String(initial);
    // Apply initial (ensures consistent mapping even if style came from other sources)
    applySpacingToTarget(target, initial);

    if (!panel.dataset.bound) {
        panel.dataset.bound = '1';
        range.addEventListener('input', function() {
            var percent = parseInt(range.value || '0', 10) || 0;
            applySpacingToTarget(target, percent);
        });
        // Update gradient for smooth UX (if supported)
        range.addEventListener('input', function() {
            var percent = parseInt(range.value || '0', 10) || 0;
            range.style.background = 'linear-gradient(to right, var(--accent, #2563eb) 0%, var(--accent, #2563eb) ' + percent + '%, rgba(255,255,255,0.15) ' + percent + '%, rgba(255,255,255,0.15) 100%)';
        });
    }
}

function updateMentalSelectionUI() {
    var ids = window._annotationMentalSelectedIds || [];
    var branchesEl = document.getElementById('annotationMentalBranches');
    if (branchesEl) {
        branchesEl.querySelectorAll('.annotation-mental-branch').forEach(function(div) {
            var id = div.dataset.id;
            if (id && ids.indexOf(id) !== -1) div.classList.add('selected');
            else div.classList.remove('selected');
        });
    }
}

function setupMentalSelection() {
    var canvas = document.getElementById('annotationMentalCanvas');
    if (!canvas || canvas.dataset.selectionSetup) return;
    canvas.dataset.selectionSetup = '1';
    canvas.addEventListener('click', function(e) {
        var branch = e.target.closest('.annotation-mental-branch');
        if (!branch) return;
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('.annotation-mental-dropdown')) return;
        var id = branch.dataset.id;
        if (!id) return;
        var ids = window._annotationMentalSelectedIds || [];
        if (e.shiftKey) {
            var i = ids.indexOf(id);
            if (i === -1) ids.push(id);
            else ids.splice(i, 1);
        } else {
            ids = [id];
        }
        window._annotationMentalSelectedIds = ids;
        updateMentalSelectionUI();
    });
}

function setupMentalKeyboard() {
    document.addEventListener('keydown', function(e) {
        var modal = document.getElementById('annotationModal');
        if (!modal || modal.classList.contains('hidden') || !modal.classList.contains('annotation-modal--mental')) return;
        if (e.key === 'Escape') {
            window._annotationMentalConnectionSourceId = null;
            var tip = document.getElementById('annotationMentalConnectionTip');
            if (tip) { tip.classList.add('hidden'); tip.style.display = 'none'; }
            window._annotationMentalSelectedIds = [];
            updateMentalSelectionUI();
        }
    });
}

var MENTAL_ZOOM_MIN = 0.25;
var MENTAL_ZOOM_MAX = 2.5;
var MENTAL_ZOOM_STEP = 0.25;
var BRANCH_CHILD_OFFSET_PX = 20;
/** Vertical spacing between sibling branches (same parent). Must be >= typical node height (140) to avoid overlap. */
var BRANCH_SIBLING_SPACING_PX = 160;
/** Default center node dimensions used when placing children of center. */
var BRANCH_CENTER_DEFAULT_WIDTH = 140;
var BRANCH_CENTER_DEFAULT_HEIGHT = 56;

function getMentalPan() {
    var p = window._annotationMentalPan;
    return (p && typeof p.x === 'number' && typeof p.y === 'number') ? p : { x: 0, y: 0 };
}

/** Centraliza a vista no anexo do mapa mental: conteúdo ao centro com zoom 1 (como na imagem). */
function centerMentalViewOnContent() {
    var data = window._annotationMentalData;
    if (!data || !data.nodes || data.nodes.length === 0) return;
    var nodes = data.nodes;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var defaultW = 170, defaultH = 96;
    nodes.forEach(function(n) {
        var x = typeof n.x === 'number' ? n.x : 150;
        var y = typeof n.y === 'number' ? n.y : 80;
        var w = (typeof n.width === 'number' ? n.width : (n.id === 'center' ? BRANCH_CENTER_DEFAULT_WIDTH : defaultW));
        var h = (typeof n.height === 'number' ? n.height : (n.id === 'center' ? BRANCH_CENTER_DEFAULT_HEIGHT : defaultH));
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    });
    if (minX === Infinity) return;
    var centerX = (minX + maxX) / 2;
    var centerY = (minY + maxY) / 2;
    var canvasW = window.innerWidth;
    var canvasH = window.innerHeight;
    if (canvasW <= 0 || canvasH <= 0) return;
    var zoom = 1;
    window._annotationMentalZoom = zoom;
    window._annotationMentalPan = {
        x: Math.round(canvasW / 2 - centerX * zoom),
        y: Math.round(canvasH / 2 - centerY * zoom)
    };
    var label = document.getElementById('annotationMentalZoomLevel');
    if (label) label.textContent = Math.round(zoom * 100) + '%';
    applyMentalTransform();
}

function applyMentalTransform() {
    var wrap = document.getElementById('annotationMentalZoomWrap');
    if (!wrap) return;
    var zoom = (typeof window._annotationMentalZoom === 'number' && window._annotationMentalZoom > 0) ? window._annotationMentalZoom : 1;
    var pan = getMentalPan();
    wrap.style.transform = 'translate(' + pan.x + 'px,' + pan.y + 'px) scale(' + zoom + ')';
}

function setMentalZoom(level) {
    level = Math.max(MENTAL_ZOOM_MIN, Math.min(MENTAL_ZOOM_MAX, Number(level) || 1));
    window._annotationMentalZoom = level;
    var label = document.getElementById('annotationMentalZoomLevel');
    if (label) label.textContent = Math.round(level * 100) + '%';
    applyMentalTransform();
}

/** Zoom mantendo o ponto (clientX, clientY) fixo no ecrã (zoom em direção ao cursor). */
function setMentalZoomTowardPoint(level, clientX, clientY) {
    var canvas = document.getElementById('annotationMentalCanvas');
    var wrap = document.getElementById('annotationMentalZoomWrap');
    if (!canvas || !wrap) return setMentalZoom(level);
    var zoomOld = (typeof window._annotationMentalZoom === 'number' && window._annotationMentalZoom > 0) ? window._annotationMentalZoom : 1;
    var panOld = getMentalPan();
    var levelClamped = Math.max(MENTAL_ZOOM_MIN, Math.min(MENTAL_ZOOM_MAX, Number(level) || 1));
    var rect = canvas.getBoundingClientRect();
    var vx = clientX - rect.left;
    var vy = clientY - rect.top;
    var cx = (vx - panOld.x) / zoomOld;
    var cy = (vy - panOld.y) / zoomOld;
    window._annotationMentalZoom = levelClamped;
    window._annotationMentalPan = {
        x: vx - cx * levelClamped,
        y: vy - cy * levelClamped
    };
    var label = document.getElementById('annotationMentalZoomLevel');
    if (label) label.textContent = Math.round(levelClamped * 100) + '%';
    applyMentalTransform();
}

function panMentalToShowNode(nodeId) {
    var canvas = document.getElementById('annotationMentalCanvas');
    var branchesEl = document.getElementById('annotationMentalBranches');
    if (!canvas || !branchesEl) return;
    var nodeEl = branchesEl.querySelector('[data-id="' + nodeId + '"]');
    if (!nodeEl) return;
    var zoom = (typeof window._annotationMentalZoom === 'number' && window._annotationMentalZoom > 0) ? window._annotationMentalZoom : 1;
    requestAnimationFrame(function () {
        var cr = canvas.getBoundingClientRect();
        var nr = nodeEl.getBoundingClientRect();
        var canvasCenterX = cr.left + cr.width / 2;
        var canvasCenterY = cr.top + cr.height / 2;
        var nodeCenterX = nr.left + nr.width / 2;
        var nodeCenterY = nr.top + nr.height / 2;
        var deltaX = canvasCenterX - nodeCenterX;
        var deltaY = canvasCenterY - nodeCenterY;
        var pan = getMentalPan();
        window._annotationMentalPan = {
            x: Math.round(pan.x + deltaX / zoom),
            y: Math.round(pan.y + deltaY / zoom)
        };
        applyMentalTransform();
    });
}

function setupMentalPan() {
    var canvas = document.getElementById('annotationMentalCanvas');
    var panLayer = document.getElementById('annotationMentalPanLayer');
    if (!canvas || canvas.dataset.panSetup) return;
    canvas.dataset.panSetup = '1';
    var startClientX = 0, startClientY = 0, startPanX = 0, startPanY = 0;
    var target = panLayer || canvas;
    function isBackgroundTarget(el) {
        return el && !el.closest('.annotation-mental-branch') && !el.closest('#annotationMentalCenter') && canvas.contains(el);
    }
    function panStart(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (panLayer) {
            if (e.target !== panLayer && !panLayer.contains(e.target)) return;
        } else if (!isBackgroundTarget(e.target)) return;
        e.preventDefault();
        startClientX = e.clientX;
        startClientY = e.clientY;
        startPanX = getMentalPan().x;
        startPanY = getMentalPan().y;
        window._annotationMentalPanning = true;
        window._annotationMentalPanPointerId = e.pointerId;
        canvas.classList.add('annotation-mental-canvas--panning');
    }
    target.addEventListener('pointerdown', panStart);
    document.addEventListener('pointermove', function(e) {
        if (!window._annotationMentalPanning) return;
        var pid = window._annotationMentalPanPointerId;
        if (pid != null && e.pointerId != null && e.pointerId !== pid) return;
        e.preventDefault();
        var dx = e.clientX - startClientX;
        var dy = e.clientY - startClientY;
        window._annotationMentalPan = { x: startPanX + dx, y: startPanY + dy };
        applyMentalTransform();
    }, { passive: false });
    function panEnd() {
        if (window._annotationMentalPanning) {
            window._annotationMentalPanning = false;
            window._annotationMentalPanPointerId = null;
            if (canvas) canvas.classList.remove('annotation-mental-canvas--panning');
        }
    }
    document.addEventListener('pointerup', panEnd);
    document.addEventListener('pointercancel', panEnd);
}

function setupMentalConnectionMode() {
    var canvas = document.getElementById('annotationMentalCanvas');
    if (!canvas || canvas.dataset.connectionModeSetup) return;
    canvas.dataset.connectionModeSetup = '1';
    canvas.addEventListener('click', function(e) {
        var sourceId = window._annotationMentalConnectionSourceId;
        if (!sourceId) return;
        if (e.target.closest('.annotation-mental-dropdown') || e.target.closest('.annotation-mental-menu-trigger')) return;
        var branch = e.target.closest('.annotation-mental-branch');
        var center = e.target.closest('#annotationMentalCenter');
        var targetId = branch ? branch.dataset.id : (center ? 'center' : null);
        if (!targetId || targetId === sourceId) return;
        var data = window._annotationMentalData;
        if (!data || !data.edges) return;
        var exists = data.edges.some(function(edge) { return edge.from === sourceId && edge.to === targetId; });
        if (!exists) {
            var srcNode = data.nodes && data.nodes.find(function(n) { return n.id === sourceId; });
            var curve = (srcNode && srcNode.curvePreference != null) ? srcNode.curvePreference : 0.4;
            data.edges.push({ from: sourceId, to: targetId, type: 'relational', curve: curve });
            if (typeof drawMentalConnections === 'function') drawMentalConnections();
        }
        window._annotationMentalConnectionSourceId = null;
        var tip = document.getElementById('annotationMentalConnectionTip');
        if (tip) { tip.classList.add('hidden'); tip.style.display = 'none'; }
    });
}

function setupMentalZoomControls() {
    var canvas = document.getElementById('annotationMentalCanvas');
    var btnIn = document.getElementById('annotationMentalZoomIn');
    var btnOut = document.getElementById('annotationMentalZoomOut');
    var btnReset = document.getElementById('annotationMentalZoomReset');
    if (btnIn) btnIn.onclick = function() { setMentalZoom((window._annotationMentalZoom || 1) + MENTAL_ZOOM_STEP); };
    if (btnOut) btnOut.onclick = function() { setMentalZoom((window._annotationMentalZoom || 1) - MENTAL_ZOOM_STEP); };
    if (btnReset) btnReset.onclick = function() { setMentalZoom(1); };
    if (canvas && !canvas.dataset.zoomWheelSetup) {
        canvas.dataset.zoomWheelSetup = '1';
        var zoomWheelRaf = null;
        var zoomWheelPending = null;
        canvas.addEventListener('wheel', function(e) {
            var target = e.target;
            if (target.closest('.annotation-mental-branch') || target.closest('.annotation-mental-dropdown')) {
                return;
            }
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') {
                return;
            }
            e.preventDefault();
            var delta = e.deltaY;
            if (delta === 0) return;
            var clientX = e.clientX;
            var clientY = e.clientY;
            if (zoomWheelRaf !== null) {
                zoomWheelPending = { delta: delta, clientX: clientX, clientY: clientY };
                return;
            }
            zoomWheelPending = { delta: delta, clientX: clientX, clientY: clientY };
            zoomWheelRaf = requestAnimationFrame(function applyZoom() {
                zoomWheelRaf = null;
                var p = zoomWheelPending;
                zoomWheelPending = null;
                if (!p) return;
                var step = Math.abs(p.delta) > 40 ? MENTAL_ZOOM_STEP * 1.2 : MENTAL_ZOOM_STEP;
                var zoomDelta = p.delta > 0 ? -step : step;
                var current = (typeof window._annotationMentalZoom === 'number' && window._annotationMentalZoom > 0) ? window._annotationMentalZoom : 1;
                var newZoom = Math.max(MENTAL_ZOOM_MIN, Math.min(MENTAL_ZOOM_MAX, current + zoomDelta));
                setMentalZoomTowardPoint(newZoom, p.clientX, p.clientY);
            });
        }, { passive: false });
    }
}

var MENTAL_PALETTE_COLORS = ['#ffffff', '#f1f5f9', '#e2e8f0', '#0d0d0d', '#1e293b', '#334155', '#475569', '#64748b', '#1e3a5f', '#1e40af', '#312e81', '#4c1d95', '#701a75', '#831843', '#9f1239', '#b91c1c', '#c2410c', '#b45309', '#4d7c0f', '#166534', '#0f766e', '#155e75', '#0e7490', '#0369a1'];

function setMentalBranchImage(branchDiv, fileOrDataUrl) {
    if (!branchDiv) return;
    var nodeId = branchDiv.dataset && branchDiv.dataset.id;
    var data = window._annotationMentalData;
    var node = data && data.nodes && nodeId ? data.nodes.find(function(n) { return n.id === nodeId; }) : null;
    var wrap = branchDiv.querySelector('.annotation-mental-branch-image');
    if (!wrap) return;

    function setImageInDom(src) {
        wrap.innerHTML = '';
        var img = document.createElement('img');
        img.className = 'annotation-mental-branch-image-img';
        img.alt = '';
        img.src = src;
        wrap.appendChild(img);
    }

    if (fileOrDataUrl instanceof File && fileOrDataUrl.type && fileOrDataUrl.type.indexOf('image') !== -1) {
        var token = localStorage.getItem('token');
        if (token) {
            if (fileOrDataUrl.size > MAX_UPLOAD_FILE_SIZE) {
                showToast('Este ficheiro é demasiado grande. Máximo 20 MB.');
                return;
            }
            // Evita o cenário em que o utilizador clica "Salvar" antes do upload terminar:
            // guardamos `imageData` temporariamente para não perder a imagem ao reabrir.
            var tempDataUrl = null;
            try {
                var reader = new FileReader();
                reader.onload = function(ev) {
                    tempDataUrl = ev && ev.target ? ev.target.result : null;
                    if (tempDataUrl && node) {
                        node.imageData = tempDataUrl;
                        // Até o upload completar, ainda não temos a referência `node.image`.
                        // O preview usa base64; quando o upload terminar, a gente troca para o URL do anexo.
                        setImageInDom(tempDataUrl);
                    }
                };
                reader.readAsDataURL(fileOrDataUrl);
            } catch (err) {}

            wrap.innerHTML = '<span class="annotation-mental-image-uploading" aria-hidden="true">A enviar…</span>';
            var uploadPromise = uploadMentalImage(fileOrDataUrl).then(function (ref) {
                if (ref && node) {
                    node.image = { attachmentId: ref.attachmentId, url: ref.url };
                    // Agora que temos a referência, removemos o base64 para reduzir tamanho.
                    if (node.imageData) delete node.imageData;
                    setImageInDom(getAttachmentFullUrl(ref.url));
                } else {
                    // Upload falhou (ou ainda não retornou): volta ao preview base64 temporário.
                    setImageInDom(tempDataUrl || '');
                }
                if (!ref && !tempDataUrl) wrap.innerHTML = '';
                return ref;
            });
            if (node) node._annotationMentalImageUploadPromise = uploadPromise;
            uploadPromise.finally(function() {
                if (node && node._annotationMentalImageUploadPromise === uploadPromise) node._annotationMentalImageUploadPromise = null;
            });
            return;
        }
    }
    var dataUrl = typeof fileOrDataUrl === 'string' ? fileOrDataUrl : null;
    if (!dataUrl) return;
    if (node) {
        node.imageData = dataUrl;
        if (node.image) delete node.image;
    }
    setImageInDom(dataUrl);
}

function setupMentalBranchImagePasteAndDrop() {
    var modal = document.getElementById('annotationModal');
    if (!modal) return;
    document.addEventListener('paste', function(e) {
        if (!modal.classList.contains('annotation-modal--mental') || modal.classList.contains('hidden')) return;
        var branch = document.activeElement && document.activeElement.closest && document.activeElement.closest('.annotation-mental-branch');
        if (!branch || !e.clipboardData || !e.clipboardData.items) return;
        var items = e.clipboardData.items;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                var file = items[i].getAsFile();
                if (!file) return;
                if (localStorage.getItem('token')) {
                    setMentalBranchImage(branch, file);
                } else {
                    var reader = new FileReader();
                    reader.onload = function(ev) {
                        var dataUrl = ev.target && ev.target.result;
                        if (dataUrl) setMentalBranchImage(branch, dataUrl);
                    };
                    reader.readAsDataURL(file);
                }
                break;
            }
        }
    });
    document.addEventListener('dragover', function(e) {
        var branch = e.target && e.target.closest && e.target.closest('.annotation-mental-branch');
        if (branch && e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    }, false);
    document.addEventListener('drop', function(e) {
        var branch = e.target && e.target.closest && e.target.closest('.annotation-mental-branch');
        if (!branch || !e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        var file = e.dataTransfer.files[0];
        if (!file || file.type.indexOf('image') === -1) return;
        if (localStorage.getItem('token')) {
            setMentalBranchImage(branch, file);
        } else {
            var reader = new FileReader();
            reader.onload = function(ev) {
                var dataUrl = ev.target && ev.target.result;
                if (dataUrl) setMentalBranchImage(branch, dataUrl);
            };
            reader.readAsDataURL(file);
        }
    }, false);
}

function closeMentalColorPaletteWithAnimation(wrap) {
    if (!wrap || wrap.classList.contains('annotation-mental-color-palette-wrap--closing')) return;
    var panel = wrap.querySelector('.annotation-mental-color-palette');
    wrap.classList.add('annotation-mental-color-palette-wrap--closing');
    function removeWrap() {
        wrap.remove();
    }
    if (panel) {
        panel.addEventListener('animationend', removeWrap, { once: true });
        setTimeout(removeWrap, 280);
    } else {
        removeWrap();
    }
}

function showMentalColorPalette(branchDiv, nodeId) {
    var data = window._annotationMentalData;
    if (!data || !data.nodes) return;
    var node = data.nodes.find(function(x) { return x.id === nodeId; });
    var originalBg = (node && node.color) || '#0d0d0d';
    var originalFont = (node && node.fontColor) || '#f8fafc';
    // Garantir que o anexo fique bem visível por baixo da paleta
    if (branchDiv && branchDiv.style) branchDiv.style.zIndex = '50';
    var pendingBg = originalBg;
    var pendingFont = originalFont;
    var existing = document.getElementById('annotationMentalColorPalette');
    if (existing) existing.remove();
    var wrap = document.createElement('div');
    wrap.id = 'annotationMentalColorPalette';
    wrap.className = 'annotation-mental-color-palette-wrap';
    var panel = document.createElement('div');
    panel.className = 'annotation-mental-color-palette';

    function updatePreview() {
        branchDiv.style.backgroundColor = pendingBg;
        branchDiv.dataset.color = pendingBg;
        branchDiv.style.color = pendingFont;
        branchDiv.dataset.fontColor = pendingFont;
    }

    function addSection(title, initialHex, isBackground, setPending) {
        var section = document.createElement('div');
        section.className = 'annotation-mental-color-palette-section';
        var titleEl = document.createElement('div');
        titleEl.className = 'annotation-mental-color-palette-section-title';
        titleEl.textContent = title;
        section.appendChild(titleEl);
        var swatchRow = document.createElement('div');
        swatchRow.className = 'annotation-mental-color-palette-swatches';
        MENTAL_PALETTE_COLORS.forEach(function(hex) {
            var swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'annotation-mental-color-swatch';
            swatch.style.backgroundColor = hex;
            swatch.title = hex;
            if (hex.toLowerCase() === initialHex.toLowerCase()) swatch.classList.add('selected');
            swatch.addEventListener('click', function() {
                setPending(hex);
                section.querySelectorAll('.annotation-mental-color-swatch').forEach(function(s) { s.classList.remove('selected'); });
                swatch.classList.add('selected');
                var customInput = section.querySelector('input[type="color"]');
                if (customInput) customInput.value = hex;
                updatePreview();
            });
            swatchRow.appendChild(swatch);
        });
        section.appendChild(swatchRow);
        var customRow = document.createElement('div');
        customRow.className = 'annotation-mental-color-custom';
        var customLabel = document.createElement('span');
        customLabel.textContent = 'Outra:';
        var customInput = document.createElement('input');
        customInput.type = 'color';
        customInput.value = /^#[0-9a-fA-F]{6}$/.test(initialHex) ? initialHex : (isBackground ? '#0d0d0d' : '#f8fafc');
        customInput.addEventListener('change', function() {
            var hex = customInput.value;
            setPending(hex);
            section.querySelectorAll('.annotation-mental-color-swatch').forEach(function(s) { s.classList.remove('selected'); });
            updatePreview();
        });
        customRow.appendChild(customLabel);
        customRow.appendChild(customInput);
        section.appendChild(customRow);
        panel.appendChild(section);
    }

    addSection('COR DO FUNDO', originalBg, true, function(hex) { pendingBg = hex; });
    addSection('COR DA FONTE', originalFont, false, function(hex) { pendingFont = hex; });

    var actions = document.createElement('div');
    actions.className = 'annotation-mental-color-palette-actions';
    var btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'annotation-mental-color-btn annotation-mental-color-btn-cancel';
    btnCancel.textContent = 'Cancelar';
    btnCancel.addEventListener('click', function() {
        branchDiv.style.backgroundColor = originalBg;
        branchDiv.dataset.color = originalBg;
        branchDiv.style.color = originalFont;
        branchDiv.dataset.fontColor = originalFont;
        closeMentalColorPaletteWithAnimation(wrap);
    });
    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'annotation-mental-color-btn annotation-mental-color-btn-save';
    btnSave.textContent = 'Salvar';
    btnSave.addEventListener('click', function() {
        if (node) {
            node.color = pendingBg;
            node.fontColor = pendingFont;
        }
        closeMentalColorPaletteWithAnimation(wrap);
    });
    actions.appendChild(btnCancel);
    actions.appendChild(btnSave);
    panel.appendChild(actions);

    wrap.appendChild(panel);
    document.body.appendChild(wrap);
    // Posicionar "em cima do anexo": centralizado horizontalmente e acima do ramo
    var rect = branchDiv.getBoundingClientRect();
    var wrapRect = wrap.getBoundingClientRect();
    var width = wrapRect.width || 420;
    var height = wrapRect.height || 240;
    var desiredLeft = rect.left + rect.width / 2 - width / 2;
    var desiredTop = rect.top - height - 10;
    wrap.style.left = Math.max(8, Math.min(desiredLeft, window.innerWidth - width - 8)) + 'px';
    wrap.style.top = Math.max(8, desiredTop) + 'px';
}

function showMentalLinhaCurvatura(branchDiv, nodeId, onClose) {
    var data = window._annotationMentalData;
    if (!data) return;
    if (onClose) onClose();
    var edgesOfNode = (data.edges || []).filter(function(e) { return e.from === nodeId || e.to === nodeId; });
    if (!edgesOfNode.length) return;
    var existing = document.getElementById('annotationMentalLinhaPanel');
    if (existing) existing.remove();
    if (window._annotationMentalLinhaEditNodeId === nodeId) {
        window._annotationMentalLinhaEditNodeId = null;
        if (typeof drawMentalConnections === 'function') drawMentalConnections();
        return;
    }
    window._annotationMentalLinhaEditNodeId = nodeId;
    if (typeof drawMentalConnections === 'function') drawMentalConnections();
    function exitLinhaEdit() {
        window._annotationMentalLinhaEditNodeId = null;
        if (typeof drawMentalConnections === 'function') drawMentalConnections();
        document.removeEventListener('keydown', onEscape);
    }
    function onEscape(e) {
        if (e.key === 'Escape') { exitLinhaEdit(); document.removeEventListener('keydown', onEscape); }
    }
    document.addEventListener('keydown', onEscape);
}

function drawMentalConnections() {
    var canvas = document.getElementById('annotationMentalCanvas');
    var svg = document.getElementById('annotationMentalConnections');
    var wrap = document.getElementById('annotationMentalZoomWrap');
    var branchesEl = document.getElementById('annotationMentalBranches');
    var data = window._annotationMentalData;
    if (!canvas || !svg || !wrap || !data) return;
    var zoom = (typeof window._annotationMentalZoom === 'number' && window._annotationMentalZoom > 0) ? window._annotationMentalZoom : 1;
    var pan = getMentalPan();
    var canvasRect = canvas.getBoundingClientRect();
    var wrapW = Math.max(canvasRect.width || 800, 800);
    var wrapH = Math.max(canvasRect.height || 600, 600);
    svg.setAttribute('viewBox', '0 0 ' + wrapW + ' ' + wrapH);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.overflow = 'visible';
    svg.innerHTML = '';
    if (!data.edges || !data.edges.length) return;
    /* Seta no fim da linha (direção: from → to) */
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    var arrowMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    arrowMarker.setAttribute('id', 'annotationMentalArrowEnd');
    arrowMarker.setAttribute('viewBox', '0 0 10 10');
    arrowMarker.setAttribute('refX', '9');
    arrowMarker.setAttribute('refY', '5');
    arrowMarker.setAttribute('markerWidth', '6.5');
    arrowMarker.setAttribute('markerHeight', '6.5');
    arrowMarker.setAttribute('orient', 'auto');
    arrowMarker.setAttribute('markerUnits', 'userSpaceOnUse');
    var arrowShape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowShape.setAttribute('d', 'M 0 0 L 10 5 L 0 10 Z');
    arrowShape.setAttribute('fill', 'rgba(255,255,255,0.78)');
    arrowMarker.appendChild(arrowShape);
    defs.appendChild(arrowMarker);
    svg.appendChild(defs);
    function screenToContent(screenX, screenY) {
        return {
            x: (screenX - canvasRect.left - pan.x) / zoom,
            y: (screenY - canvasRect.top - pan.y) / zoom
        };
    }
    function segmentRectIntersection(x1, y1, x2, y2, rx, ry, rw, rh) {
        var dx = x2 - x1, dy = y2 - y1;
        var bestT = 2, out = { x: x2, y: y2 };
        function tryEdge(t, onEdge) {
            if (t >= 0 && t < 1 && t < bestT && onEdge()) { bestT = t; out.x = x1 + t * dx; out.y = y1 + t * dy; }
        }
        if (Math.abs(dx) > 1e-9) {
            var tL = (rx - x1) / dx; tryEdge(tL, function() { var y = y1 + tL * dy; return y >= ry && y <= ry + rh; });
            var tR = (rx + rw - x1) / dx; tryEdge(tR, function() { var y = y1 + tR * dy; return y >= ry && y <= ry + rh; });
        }
        if (Math.abs(dy) > 1e-9) {
            var tT = (ry - y1) / dy; tryEdge(tT, function() { var x = x1 + tT * dx; return x >= rx && x <= rx + rw; });
            var tB = (ry + rh - y1) / dy; tryEdge(tB, function() { var x = x1 + tB * dx; return x >= rx && x <= rx + rw; });
        }
        return out;
    }
    data.edges.forEach(function(edge, idx) {
        var fromEl = edge.from === 'center' ? document.getElementById('annotationMentalCenter') : (branchesEl && branchesEl.querySelector('[data-id="' + edge.from + '"]'));
        var toEl = edge.to === 'center' ? document.getElementById('annotationMentalCenter') : (branchesEl && branchesEl.querySelector('[data-id="' + edge.to + '"]'));
        if (!fromEl || !toEl) return;
        var fromR = fromEl.getBoundingClientRect();
        var toR = toEl.getBoundingClientRect();
        var fromC = screenToContent(fromR.left + fromR.width / 2, fromR.top + fromR.height / 2);
        var toC = screenToContent(toR.left + toR.width / 2, toR.top + toR.height / 2);
        var x1 = fromC.x, y1 = fromC.y, x2 = toC.x, y2 = toC.y;
        var midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
        var cpx = (edge.controlPoint && typeof edge.controlPoint.x === 'number' && typeof edge.controlPoint.y === 'number')
            ? edge.controlPoint.x : midX;
        var cpy = (edge.controlPoint && typeof edge.controlPoint.y === 'number')
            ? edge.controlPoint.y : midY;
        var d = 'M ' + x1 + ' ' + y1 + ' Q ' + cpx + ' ' + cpy + ' ' + x2 + ' ' + y2;
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'rgba(255,255,255,0.72)');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('marker-end', 'url(#annotationMentalArrowEnd)');
        path.setAttribute('class', 'annotation-mental-connection-path');
        svg.appendChild(path);
        var linhaEditId = window._annotationMentalLinhaEditNodeId;
        if (linhaEditId && (edge.from === linhaEditId || edge.to === linhaEditId)) {
            var r = 6;
            ['inicio', 'meio', 'fim'].forEach(function(role, i) {
                var cx = (role === 'inicio') ? x1 : (role === 'meio') ? cpx : x2;
                var cy = (role === 'inicio') ? y1 : (role === 'meio') ? cpy : y2;
                var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', cx);
                circle.setAttribute('cy', cy);
                circle.setAttribute('r', r);
                circle.setAttribute('class', 'annotation-mental-linha-handle annotation-mental-linha-handle--' + role);
                circle.setAttribute('data-edge-idx', String(idx));
                if (role === 'meio') {
                    circle.style.cursor = 'move';
                    (function(edgeRef) {
                        circle.addEventListener('mousedown', function(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            var onMove = function(ev) {
                                var c = document.getElementById('annotationMentalCanvas');
                                if (!c) return;
                                var rect = c.getBoundingClientRect();
                                var p = getMentalPan();
                                var z = (typeof window._annotationMentalZoom === 'number' && window._annotationMentalZoom > 0) ? window._annotationMentalZoom : 1;
                                var pt = { x: (ev.clientX - rect.left - p.x) / z, y: (ev.clientY - rect.top - p.y) / z };
                                edgeRef.controlPoint = { x: pt.x, y: pt.y };
                                if (typeof drawMentalConnections === 'function') drawMentalConnections();
                            };
                            var onUp = function() {
                                document.removeEventListener('mousemove', onMove);
                                document.removeEventListener('mouseup', onUp);
                            };
                            document.addEventListener('mousemove', onMove);
                            document.addEventListener('mouseup', onUp);
                        });
                    })(edge);
                }
                svg.appendChild(circle);
            });
        }
    });
}


function duplicateMentalNode(nodeId) {
    var branchesEl = document.getElementById('annotationMentalBranches');
    var data = window._annotationMentalData;
    if (!branchesEl || !data || !data.nodes) return;
    var node = data.nodes.find(function(n) { return n.id === nodeId; });
    if (!node) return;
    var nextId = window._annotationMentalNextId != null ? window._annotationMentalNextId : 1;
    var newId = 'b' + nextId;
    window._annotationMentalNextId = nextId + 1;
    var newNode = {
        id: newId,
        label: node.label || '',
        description: node.description || '',
        color: node.color || '',
        fontColor: node.fontColor || '',
        image: (node.image && node.image.attachmentId && node.image.url) ? { attachmentId: node.image.attachmentId, url: node.image.url } : undefined,
        imageData: node.imageData || '',
        x: (typeof node.x === 'number' ? node.x : 200) + 20,
        y: (typeof node.y === 'number' ? node.y : 120) + 20,
        width: node.width || 140,
        height: node.height || 140
    };
    data.nodes.push(newNode);
    var toAdd = [];
    (data.edges || []).forEach(function(edge) {
        if (edge.from === nodeId) toAdd.push({ from: newId, to: edge.to, type: edge.type || 'hierarchical', curve: edge.curve, controlPoint: edge.controlPoint ? { x: edge.controlPoint.x, y: edge.controlPoint.y } : undefined });
    });
    toAdd.forEach(function(e) { data.edges.push(e); });
    var div = createMentalBranchNode(newNode, branchesEl);
    branchesEl.appendChild(div);
    requestAnimationFrame(function () {
        div.classList.add('annotation-mental-branch--spawn');
        div.addEventListener('animationend', function onSpawnEnd() {
            div.classList.remove('annotation-mental-branch--spawn');
            div.removeEventListener('animationend', onSpawnEnd);
        }, { once: true });
    });
    if (typeof drawMentalConnections === 'function') drawMentalConnections();
}

function addMentalBranchFloating(initialLabel) {
    var branchesEl = document.getElementById('annotationMentalBranches');
    const centerEl = document.getElementById('annotationMentalCenter');
    if (!branchesEl) return;
    var data = window._annotationMentalData;
    if (!data || !data.nodes || !data.nodes.some(function (n) { return n.id === 'center'; })) {
        if (typeof initAnnotationMental === 'function') initAnnotationMental();
        data = window._annotationMentalData;
    }
    if (!data) data = { nodes: [{ id: 'center', label: (centerEl && centerEl.textContent) || '', x: 150, y: 80 }], edges: [] };
    if (!window._annotationMentalData) window._annotationMentalData = data;
    data.nodes = data.nodes || [];
    data.edges = data.edges || [];
    const nextId = window._annotationMentalNextId != null ? window._annotationMentalNextId : 1;
    const id = 'b' + nextId;
    window._annotationMentalNextId = nextId + 1;
    const label = typeof initialLabel === 'string' ? initialLabel.trim() : '';
    var nodeW = 140;
    var nodeH = 140;
    var centerNode = data.nodes && data.nodes.find(function (n) { return n.id === 'center'; });
    var centerX = (centerNode && typeof centerNode.x === 'number') ? centerNode.x : 150;
    var centerY = (centerNode && typeof centerNode.y === 'number') ? centerNode.y : 80;
    var centerW = (centerNode && typeof centerNode.width === 'number') ? centerNode.width : BRANCH_CENTER_DEFAULT_WIDTH;
    var centerH = (centerNode && typeof centerNode.height === 'number') ? centerNode.height : BRANCH_CENTER_DEFAULT_HEIGHT;
    var nodeX = Math.max(0, centerX + centerW + BRANCH_CHILD_OFFSET_PX);
    var nodeY = Math.max(0, centerY);
    const newNode = { id: id, label: label, x: nodeX, y: nodeY, width: nodeW, height: nodeH };
    data.nodes.push(newNode);
    const div = createMentalBranchNode(newNode, branchesEl);
    div.style.zIndex = '10';
    div.style.visibility = 'visible';
    div.style.display = 'flex';
    div.style.opacity = '1';
    branchesEl.appendChild(div);
    requestAnimationFrame(function () {
        div.classList.add('annotation-mental-branch--spawn');
        div.addEventListener('animationend', function onSpawnEnd() {
            div.classList.remove('annotation-mental-branch--spawn');
            div.removeEventListener('animationend', onSpawnEnd);
        }, { once: true });
    });
    if (typeof drawMentalConnections === 'function') drawMentalConnections();
    panMentalToShowNode(id);
    requestAnimationFrame(function () {
        try { div.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' }); } catch (e) {}
    });
}

function addMentalTextBalloon() {
    var branchesEl = document.getElementById('annotationMentalBranches');
    const centerEl = document.getElementById('annotationMentalCenter');
    if (!branchesEl) return;
    var data = window._annotationMentalData;
    if (!data || !data.nodes || !data.nodes.some(function (n) { return n.id === 'center'; })) {
        if (typeof initAnnotationMental === 'function') initAnnotationMental();
        data = window._annotationMentalData;
    }
    if (!data) data = { nodes: [{ id: 'center', label: (centerEl && centerEl.textContent) || '', x: 150, y: 80 }], edges: [] };
    if (!window._annotationMentalData) window._annotationMentalData = data;
    data.nodes = data.nodes || [];
    data.edges = data.edges || [];
    const nextId = window._annotationMentalNextId != null ? window._annotationMentalNextId : 1;
    const id = 'b' + nextId;
    window._annotationMentalNextId = nextId + 1;
    var centerNode = data.nodes && data.nodes.find(function (n) { return n.id === 'center'; });
    var centerX = (centerNode && typeof centerNode.x === 'number') ? centerNode.x : 150;
    var centerY = (centerNode && typeof centerNode.y === 'number') ? centerNode.y : 80;
    var centerW = (centerNode && typeof centerNode.width === 'number') ? centerNode.width : BRANCH_CENTER_DEFAULT_WIDTH;
    var centerH = (centerNode && typeof centerNode.height === 'number') ? centerNode.height : BRANCH_CENTER_DEFAULT_HEIGHT;
    var nodeX = Math.max(0, centerX + centerW + BRANCH_CHILD_OFFSET_PX);
    var nodeY = Math.max(0, centerY);
    const newNode = { id: id, label: '', x: nodeX, y: nodeY, width: 220, height: 72, shape: 'balloon' };
    data.nodes.push(newNode);
    const div = createMentalBranchNode(newNode, branchesEl);
    div.style.zIndex = '10';
    div.style.visibility = 'visible';
    div.style.display = 'flex';
    div.style.opacity = '1';
    branchesEl.appendChild(div);
    requestAnimationFrame(function () {
        div.classList.add('annotation-mental-branch--spawn');
        div.addEventListener('animationend', function onSpawnEnd() {
            div.classList.remove('annotation-mental-branch--spawn');
            div.removeEventListener('animationend', onSpawnEnd);
        }, { once: true });
    });
    if (typeof drawMentalConnections === 'function') drawMentalConnections();
    panMentalToShowNode(id);
}

function showMentalAddPreview() {
    var preview = document.getElementById('annotationMentalAddPreview');
    var input = document.getElementById('annotationMentalAddPreviewInput');
    if (!preview || !input) return;
    preview.classList.remove('hidden');
    preview.style.display = 'flex';
    preview.style.visibility = 'visible';
    input.value = '';
    input.focus();
}

function hideMentalAddPreview() {
    var preview = document.getElementById('annotationMentalAddPreview');
    var input = document.getElementById('annotationMentalAddPreviewInput');
    if (preview) {
        preview.classList.add('hidden');
        preview.style.display = '';
        preview.style.visibility = '';
    }
    if (input) input.value = '';
    window._annotationMentalPendingParentId = null;
}

function confirmMentalAddPreview() {
    var input = document.getElementById('annotationMentalAddPreviewInput');
    var label = input ? input.value.trim() : '';
    var parentId = window._annotationMentalPendingParentId || null;
    hideMentalAddPreview();
    window._annotationMentalPendingParentId = null;
    function doAdd() {
        if (parentId) {
            addChildBranch(parentId, label);
        } else {
            try {
                addMentalBranchFloating(label);
            } catch (err) {
                console.error('Erro ao criar nó flutuante no mapa mental:', err);
                if (typeof initAnnotationMental === 'function') initAnnotationMental();
                addMentalBranchFloating(label);
            }
        }
    }
    requestAnimationFrame(function () {
        requestAnimationFrame(doAdd);
    });
}

function addChildBranch(parentId, initialLabel) {
    const branchesEl = document.getElementById('annotationMentalBranches');
    const centerEl = document.getElementById('annotationMentalCenter');
    if (!branchesEl) return;
    const parentEl = parentId === 'center' ? document.getElementById('annotationMentalCenter') : branchesEl.querySelector('[data-id="' + parentId + '"]');
    if (!parentEl && parentId !== 'center') return;
    const nextId = window._annotationMentalNextId != null ? window._annotationMentalNextId : 1;
    const id = 'b' + nextId;
    window._annotationMentalNextId = nextId + 1;
    const data = window._annotationMentalData || { nodes: [{ id: 'center', label: (centerEl && centerEl.textContent) || '', x: 150, y: 80 }], edges: [] };
    if (!window._annotationMentalData) window._annotationMentalData = data;
    data.nodes = data.nodes || [];
    data.edges = data.edges || [];
    var childHeight = 140;
    var childWidth = 140;
    var px, py, pw, ph;
    var parentNode = data.nodes.find(function (n) { return n.id === parentId; });
    if (parentId === 'center') {
        px = (parentNode && typeof parentNode.x === 'number') ? parentNode.x : 150;
        py = (parentNode && typeof parentNode.y === 'number') ? parentNode.y : 80;
        pw = BRANCH_CENTER_DEFAULT_WIDTH;
        ph = BRANCH_CENTER_DEFAULT_HEIGHT;
    } else if (parentNode) {
        px = typeof parentNode.x === 'number' ? parentNode.x : (parseFloat(parentEl.dataset.x) || 0);
        py = typeof parentNode.y === 'number' ? parentNode.y : (parseFloat(parentEl.dataset.y) || 0);
        pw = typeof parentNode.width === 'number' ? parentNode.width : (parseFloat(parentEl.dataset.width) || 140);
        ph = typeof parentNode.height === 'number' ? parentNode.height : (parseFloat(parentEl.dataset.height) || 140);
    } else if (parentEl) {
        px = parseFloat(parentEl.dataset.x) || 0;
        py = parseFloat(parentEl.dataset.y) || 0;
        pw = parseFloat(parentEl.dataset.width) || 140;
        ph = parseFloat(parentEl.dataset.height) || 140;
    } else {
        px = 150;
        py = 80;
        pw = BRANCH_CENTER_DEFAULT_WIDTH;
        ph = BRANCH_CENTER_DEFAULT_HEIGHT;
    }
    var siblingCount = (data.edges && data.edges.length) ? data.edges.filter(function (e) { return e.from === parentId; }).length : 0;
    var childLeft = Math.round(px + pw + BRANCH_CHILD_OFFSET_PX);
    var childTop = Math.round(py + (ph / 2) - (childHeight / 2) + siblingCount * BRANCH_SIBLING_SPACING_PX);
    childLeft = Math.max(0, childLeft);
    childTop = Math.max(0, childTop);
    if (typeof childLeft !== 'number' || isNaN(childLeft)) childLeft = 200;
    if (typeof childTop !== 'number' || isNaN(childTop)) childTop = 180;
    const newNode = { id: id, label: typeof initialLabel === 'string' ? initialLabel : '', x: childLeft, y: childTop, width: childWidth, height: childHeight };
    data.nodes.push(newNode);
    var parentNode = data.nodes && data.nodes.find(function(n) { return n.id === parentId; });
    var curve = (parentNode && parentNode.curvePreference != null) ? parentNode.curvePreference : 0.4;
    data.edges.push({ from: parentId, to: id, type: 'hierarchical', curve: curve });
    const div = createMentalBranchNode(newNode, branchesEl);
    div.style.visibility = 'visible';
    div.style.display = 'flex';
    branchesEl.appendChild(div);
    requestAnimationFrame(function () {
        div.classList.add('annotation-mental-branch--spawn');
        div.addEventListener('animationend', function onSpawnEnd() {
            div.classList.remove('annotation-mental-branch--spawn');
            div.removeEventListener('animationend', onSpawnEnd);
        }, { once: true });
    });
    if (typeof drawMentalConnections === 'function') drawMentalConnections();
    requestAnimationFrame(function () {
        try { div.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' }); } catch (e) {}
    });
}

var BRANCH_SIZE_MIN = 100;
var BRANCH_SIZE_MAX = 1600;

function createMentalBranchNode(n, branchesEl) {
    const div = document.createElement('div');
    div.className = 'annotation-mental-branch' + (n.shape === 'balloon' ? ' annotation-mental-branch--balloon' : '');
    div.dataset.id = n.id;
    const x = typeof n.x === 'number' ? n.x : 200;
    const y = typeof n.y === 'number' ? n.y : 120;
    const defaultW = n.shape === 'balloon' ? 220 : 170;
    const defaultH = n.shape === 'balloon' ? 72 : 96;
    const w = typeof n.width === 'number' && n.width >= BRANCH_SIZE_MIN ? Math.min(n.width, BRANCH_SIZE_MAX) : defaultW;
    const h = typeof n.height === 'number' && n.height >= BRANCH_SIZE_MIN ? Math.min(n.height, BRANCH_SIZE_MAX) : defaultH;
    div.style.left = x + 'px';
    div.style.top = y + 'px';
    div.style.width = w + 'px';
    div.style.minHeight = h + 'px';
    div.dataset.width = String(w);
    div.dataset.height = String(h);
    var bgColor = (typeof n.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(n.color)) ? n.color : '#0d0d0d';
    var fontColor = (typeof n.fontColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(n.fontColor)) ? n.fontColor : '#f8fafc';
    div.style.backgroundColor = bgColor;
    div.dataset.color = n.color || '';
    div.style.color = fontColor;
    div.dataset.fontColor = n.fontColor || '';
    div.style.border = '1px solid rgba(255,255,255,0.15)';
    div.style.borderRadius = '8px';
    div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
    div.style.position = 'absolute';
    div.style.display = 'flex';
    div.style.flexDirection = 'column';
    div.style.padding = '8px';
    div.style.zIndex = '5';
    div.dataset.x = String(x);
    div.dataset.y = String(y);
    const label = document.createElement('div');
    label.className = 'annotation-mental-branch-label';
    label.contentEditable = 'true';
    // Persist formatting by saving/restoring HTML (I/U/S/etc). Older data might only have `label`.
    const isLegacyBalloonPlaceholder = n.shape === 'balloon' && (
        (typeof n.label === 'string' && n.label.trim().toLowerCase() === 'texto') ||
        (typeof n.labelHtml === 'string' && n.labelHtml.trim().toLowerCase() === 'texto')
    );
    if (isLegacyBalloonPlaceholder) {
        label.textContent = '';
    } else if (typeof n.labelHtml === 'string') {
        label.innerHTML = n.labelHtml;
    } else {
        label.textContent = n.label || '';
    }
    label.setAttribute('data-placeholder', n.shape === 'balloon' ? 'Texto' : 'Ramo');
    if (n.labelStyle && typeof n.labelStyle === 'object') {
        if (typeof n.labelStyle.color === 'string') label.style.color = n.labelStyle.color;
        if (typeof n.labelStyle.fontSize === 'string') label.style.fontSize = n.labelStyle.fontSize;
        if (typeof n.labelStyle.letterSpacing === 'string') label.style.letterSpacing = n.labelStyle.letterSpacing;
        if (typeof n.labelStyle.lineHeight === 'string') label.style.lineHeight = n.labelStyle.lineHeight;
        if (typeof n.labelStyle.textIndent === 'string') label.style.textIndent = n.labelStyle.textIndent;
    }
    const addChild = document.createElement('button');
    addChild.type = 'button';
    addChild.className = 'annotation-mental-add-child';
    addChild.textContent = 'Criar filial';
    addChild.dataset.parentId = n.id;
    const descBtn = document.createElement('button');
    descBtn.type = 'button';
    descBtn.className = 'annotation-mental-description-btn';
    descBtn.textContent = 'Descrição';
    descBtn.onclick = function(e) {
        e.stopPropagation();
        closeDropdown();
        div.classList.toggle('has-description');
    };
    const configurarBtn = document.createElement('button');
    configurarBtn.type = 'button';
    configurarBtn.className = 'annotation-mental-configurar-texto';
    configurarBtn.textContent = 'Configurar';
    configurarBtn.onclick = function(e) {
        e.stopPropagation();
        closeDropdown();
        var target = window._annotationMentalTextConfigTarget || label;
        if (typeof openMentalTextConfigToolbar === 'function') openMentalTextConfigToolbar(target);
        // Garantir foco para os comandos de texto funcionarem no contentEditable
        if (target && typeof target.focus === 'function') target.focus();
    };
    const dimensionarBtn = document.createElement('button');
    dimensionarBtn.type = 'button';
    dimensionarBtn.className = 'annotation-mental-dimensionar-btn';
    dimensionarBtn.textContent = 'Dimensionar';
    function updateDimensionarButtonState() {
        var isBranch = div.classList.contains('annotation-mental-branch--resize-mode');
        var isFont = div.classList.contains('annotation-mental-branch--font-resize-mode');

        // Se o alvo atual do "Configurar" for TÍTULO ou DESCRIÇÃO, o botão deve dizer "Dimesionar texto"
        var target = window._annotationMentalTextConfigTarget || null;
        var isTextTarget = !!(target && (target === label || target === descArea));

        if (isFont) {
            dimensionarBtn.innerHTML = 'Dimesionar texto <span class="annotation-mental-dimensionar-close" aria-label="Parar">✕</span>';
        } else if (isBranch) {
            dimensionarBtn.innerHTML = 'Dimesionar <span class="annotation-mental-dimensionar-close" aria-label="Parar">✕</span>';
        } else if (isTextTarget) {
            dimensionarBtn.textContent = 'Dimesionar texto';
        } else {
            dimensionarBtn.textContent = 'Dimesionar';
        }
    }
    dimensionarBtn.onclick = function(e) {
        e.stopPropagation();
        closeDropdown();
        var target = window._annotationMentalTextConfigTarget || null;
        var isTextTarget = !!(target && (target === label || target === descArea));

        function positionHandlesToElement(el) {
            var wrap = div._annotationMentalResizeHandlesWrap;
            if (!wrap || !el || typeof el.getBoundingClientRect !== 'function') return;
            var dr = div.getBoundingClientRect();
            var er = el.getBoundingClientRect();
            // Pequeno "respiro" para as bolinhas não ficarem coladas ao texto
            var pad = 4;
            var left = (er.left - dr.left) - pad;
            var top = (er.top - dr.top) - pad;
            var width = er.width + pad * 2;
            var height = er.height + pad * 2;
            wrap.style.left = left + 'px';
            wrap.style.top = top + 'px';
            wrap.style.width = width + 'px';
            wrap.style.height = height + 'px';
        }

        function positionHandlesToBranch() {
            var wrap = div._annotationMentalResizeHandlesWrap;
            if (!wrap) return;
            wrap.style.left = '0px';
            wrap.style.top = '0px';
            wrap.style.width = '100%';
            wrap.style.height = '100%';
        }

        if (isTextTarget) {
            // Dimensionar deve mexer no font-size do texto (TÍTULO ou DESCRIÇÃO)
            if (div.classList.contains('annotation-mental-branch--font-resize-mode')) {
                div.classList.remove('annotation-mental-branch--font-resize-mode');
                div._annotationMentalResizeTargetEl = null;
                positionHandlesToBranch();
            } else {
                div.classList.add('annotation-mental-branch--font-resize-mode');
                div.classList.remove('annotation-mental-branch--resize-mode');
                div._annotationMentalResizeTargetEl = target;
                positionHandlesToElement(target);
            }
        } else {
            // Dimensionar deve mexer no anexo (tamanho do ramo)
            if (div.classList.contains('annotation-mental-branch--resize-mode')) {
                div.classList.remove('annotation-mental-branch--resize-mode');
                div._annotationMentalResizeTargetEl = null;
                positionHandlesToBranch();
            } else {
                div.classList.add('annotation-mental-branch--resize-mode');
                div.classList.remove('annotation-mental-branch--font-resize-mode');
                div._annotationMentalResizeTargetEl = null;
                positionHandlesToBranch();
            }
        }
        updateDimensionarButtonState();
    };
    const linhaBtn = document.createElement('button');
    linhaBtn.type = 'button';
    linhaBtn.className = 'annotation-mental-linha-btn';
    linhaBtn.textContent = 'Linha';
    function updateLinhaButtonState() {
        if (window._annotationMentalLinhaEditNodeId === n.id) {
            linhaBtn.innerHTML = 'Linha <span class="annotation-mental-linha-close" aria-label="Desligar">✕</span>';
        } else {
            linhaBtn.textContent = 'Linha';
        }
    }
    linhaBtn.onclick = function(e) {
        e.stopPropagation();
        showMentalLinhaCurvatura(div, n.id, closeDropdown);
        updateLinhaButtonState();
    };
    const connectionBtn = document.createElement('button');
    connectionBtn.type = 'button';
    connectionBtn.className = 'annotation-mental-connection-manual';
    connectionBtn.textContent = 'Criar conexão manual';
    connectionBtn.onclick = function(e) {
        e.stopPropagation();
        closeDropdown();
        window._annotationMentalConnectionSourceId = n.id;
        var tip = document.getElementById('annotationMentalConnectionTip');
        if (tip) { tip.classList.remove('hidden'); tip.style.display = 'block'; }
    };
    const duplicateBtn = document.createElement('button');
    duplicateBtn.type = 'button';
    duplicateBtn.className = 'annotation-mental-duplicate';
    duplicateBtn.textContent = 'Duplicar';
    duplicateBtn.onclick = function(e) {
        e.stopPropagation();
        closeDropdown();
        duplicateMentalNode(n.id);
    };
    const colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.className = 'annotation-mental-color';
    colorBtn.textContent = 'Alterar cor';
    colorBtn.onclick = function(e) {
        e.stopPropagation();
        closeDropdown();
        showMentalColorPalette(div, n.id);
    };
    const removerBtn = document.createElement('button');
    removerBtn.type = 'button';
    removerBtn.className = 'annotation-mental-remover';
    removerBtn.textContent = 'Remover';
    removerBtn.onclick = function(e) {
        e.stopPropagation();
        closeDropdown();
        if (n.id === 'center') {
            alert('O nó central não pode ser removido.');
            return;
        }
        if (!confirm('Quer realmente remover este ramo?')) return;
        var data = window._annotationMentalData;
        var branchesEl = document.getElementById('annotationMentalBranches');
        if (!data || !branchesEl) return;
        if (data.nodes) data.nodes = data.nodes.filter(function(node) { return node.id !== n.id; });
        if (data.edges) data.edges = data.edges.filter(function(edge) { return edge.from !== n.id && edge.to !== n.id; });
        div.remove();
        if (window._annotationMentalSelectedIds) {
            window._annotationMentalSelectedIds = window._annotationMentalSelectedIds.filter(function(id) { return id !== n.id; });
            updateMentalSelectionUI();
        }
        if (typeof drawMentalConnections === 'function') drawMentalConnections();
    };
    const dropdown = document.createElement('div');
    dropdown.className = 'annotation-mental-dropdown';
    dropdown.appendChild(addChild);
    dropdown.appendChild(connectionBtn);
    dropdown.appendChild(duplicateBtn);
    dropdown.appendChild(colorBtn);
    dropdown.appendChild(linhaBtn);
    dropdown.appendChild(descBtn);
    dropdown.appendChild(configurarBtn);
    dropdown.appendChild(dimensionarBtn);
    dropdown.appendChild(removerBtn);
    function closeDropdown() {
        dropdown.classList.remove('is-open');
        document.removeEventListener('click', closeOnClickOutside);
    }
    function closeOnClickOutside(e) {
        if (!div.contains(e.target)) closeDropdown();
    }
    const menuTrigger = document.createElement('button');
    menuTrigger.type = 'button';
    menuTrigger.className = 'annotation-mental-menu-trigger annotation-mental-menu-trigger--anexo';
    menuTrigger.setAttribute('aria-label', 'Ações');
    menuTrigger.textContent = '\u22EE';
    function toggleBranchDropdown(e, targetEl) {
        window._annotationMentalTextConfigTarget = targetEl || null;
        // "Configurar" só deve aparecer quando o contexto for TÍTULO ou DESCRIÇÃO
        if (configurarBtn && configurarBtn.style) {
            configurarBtn.style.display = targetEl ? '' : 'none';
        }
        e.preventDefault();
        e.stopPropagation();
        var isOpen = dropdown.classList.toggle('is-open');
        if (isOpen) {
            updateDimensionarButtonState();
            if (typeof updateLinhaButtonState === 'function') updateLinhaButtonState();
            setTimeout(function() { document.addEventListener('click', closeOnClickOutside); }, 0);
        } else {
            document.removeEventListener('click', closeOnClickOutside);
        }
    }
    // ⋮ do ANEXO: não marca o T/D como alvo do "Dimensionar"
    menuTrigger.addEventListener('click', function(e) { toggleBranchDropdown(e, null); });
    const actions = document.createElement('div');
    actions.className = 'annotation-mental-branch-actions';
    // Botão ⋮ + dropdown com as opções do anexo
    actions.appendChild(menuTrigger);
    actions.appendChild(dropdown);
    const header = document.createElement('div');
    header.className = 'annotation-mental-branch-header';
    const tituloMenuTrigger = document.createElement('button');
    tituloMenuTrigger.type = 'button';
    tituloMenuTrigger.className = 'annotation-mental-menu-trigger annotation-mental-menu-trigger--titulo';
    tituloMenuTrigger.setAttribute('aria-label', 'Configurar título');
    tituloMenuTrigger.textContent = '\u22EE';
    tituloMenuTrigger.addEventListener('click', function(e) { toggleBranchDropdown(e, label); });
    header.appendChild(tituloMenuTrigger);
    header.appendChild(label);
    div.appendChild(header);
    div.insertBefore(actions, header);
    const imageWrap = document.createElement('div');
    imageWrap.className = 'annotation-mental-branch-image';
    var imgSrc = (n.image && n.image.url) ? getAttachmentFullUrl(n.image.url) : (typeof n.imageData === 'string' && n.imageData.length > 0 ? n.imageData : '');
    if (imgSrc) {
        var img = document.createElement('img');
        img.className = 'annotation-mental-branch-image-img';
        img.alt = '';
        img.src = imgSrc;
        imageWrap.appendChild(img);
    }
    div.appendChild(imageWrap);
    const descWrap = document.createElement('div');
    descWrap.className = 'annotation-mental-branch-description';
    const descArea = document.createElement('div');
    descArea.className = 'annotation-mental-branch-description-editor';
    descArea.contentEditable = 'true';
    descArea.setAttribute('data-placeholder', 'Descrição...');
    // Persist formatting by saving/restoring HTML.
    if (typeof n.descriptionHtml === 'string') descArea.innerHTML = n.descriptionHtml;
    else descArea.textContent = (typeof n.description === 'string' ? n.description : '');
    if (n.descriptionStyle && typeof n.descriptionStyle === 'object') {
        if (typeof n.descriptionStyle.color === 'string') descArea.style.color = n.descriptionStyle.color;
        if (typeof n.descriptionStyle.fontSize === 'string') descArea.style.fontSize = n.descriptionStyle.fontSize;
        if (typeof n.descriptionStyle.letterSpacing === 'string') descArea.style.letterSpacing = n.descriptionStyle.letterSpacing;
        if (typeof n.descriptionStyle.lineHeight === 'string') descArea.style.lineHeight = n.descriptionStyle.lineHeight;
        if (typeof n.descriptionStyle.textIndent === 'string') descArea.style.textIndent = n.descriptionStyle.textIndent;
    }
    const descricaoMenuTrigger = document.createElement('button');
    descricaoMenuTrigger.type = 'button';
    descricaoMenuTrigger.className = 'annotation-mental-menu-trigger annotation-mental-menu-trigger--descricao';
    descricaoMenuTrigger.setAttribute('aria-label', 'Configurar descrição');
    descricaoMenuTrigger.textContent = '\u22EE';
    descricaoMenuTrigger.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        // Garante que a descrição fique visível para o usuário interagir
        div.classList.add('has-description');
        if (typeof openMentalTextConfigToolbar === 'function') window._annotationMentalTextConfigTarget = descArea;
        if (descArea && typeof descArea.focus === 'function') descArea.focus();
        toggleBranchDropdown(e, descArea);
    });
    descWrap.appendChild(descricaoMenuTrigger);
    descWrap.appendChild(descArea);
    div.appendChild(descWrap);
    if ((descArea.textContent || '').trim()) div.classList.add('has-description');
    addMentalBranchResizeHandles(div);
    makeMentalBranchDraggable(div, branchesEl);
    return div;
}

function addMentalBranchResizeHandles(div) {
    var edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    var wrap = document.createElement('div');
    wrap.className = 'annotation-mental-resize-handles';
    edges.forEach(function(edge) {
        var h = document.createElement('div');
        h.className = 'annotation-mental-resize-handle annotation-mental-resize-handle--' + edge;
        h.dataset.edge = edge;
        h.setAttribute('aria-label', 'Redimensionar');
        wrap.appendChild(h);
    });
    div.appendChild(wrap);
    // Guardar referência para reposicionar as bolinhas (font vs branch)
    div._annotationMentalResizeHandlesWrap = wrap;
    wrap.style.left = '0px';
    wrap.style.top = '0px';
    wrap.style.width = '100%';
    wrap.style.height = '100%';
    makeMentalBranchResizable(div);
}

function makeMentalBranchResizable(div) {
    var container = div.parentElement;
    div.querySelectorAll('.annotation-mental-resize-handle').forEach(function(handle) {
        handle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var edge = handle.dataset.edge;
            var startX = e.clientX;
            var startY = e.clientY;
            var startW = parseInt(div.dataset.width || div.style.width || '140', 10) || 140;
            var startH = parseInt(div.dataset.height || div.style.minHeight || '140', 10) || 140;
            var startLeft = parseInt(div.style.left || '0', 10) || 0;
            var startTop = parseInt(div.style.top || '0', 10) || 0;
            var isFontResize = div.classList.contains('annotation-mental-branch--font-resize-mode');
            var textTarget = isFontResize ? (div._annotationMentalResizeTargetEl || window._annotationMentalTextConfigTarget || null) : null;
            var startFontSize = null;
            // Quando estamos redimensionando TEXTO, fixamos o tamanho do anexo
            // para evitar que a mudança de font-size "empurre" o layout do ramo.
            var prevInlineWidth = div.style.width;
            var prevInlineMinHeight = div.style.minHeight;
            var prevInlineHeight = div.style.height;
            if (isFontResize) {
                div.style.width = startW + 'px';
                div.style.minHeight = startH + 'px';
                div.style.height = startH + 'px';
            }
            if (isFontResize && textTarget) {
                var cs = (typeof window.getComputedStyle === 'function') ? window.getComputedStyle(textTarget) : null;
                var fs = cs && cs.fontSize ? parseFloat(cs.fontSize) : NaN;
                if (typeof textTarget.style.fontSize === 'string' && textTarget.style.fontSize.trim()) {
                    var styled = parseFloat(textTarget.style.fontSize);
                    if (!isNaN(styled)) fs = styled;
                }
                startFontSize = !isNaN(fs) ? fs : 16;
            }
            function updateHandlesToTarget(el) {
                var wrap = div._annotationMentalResizeHandlesWrap;
                if (!wrap || !el || typeof el.getBoundingClientRect !== 'function') return;
                var dr = div.getBoundingClientRect();
                var er = el.getBoundingClientRect();
                var pad = 4;
                var left = (er.left - dr.left) - pad;
                var top = (er.top - dr.top) - pad;
                var width = er.width + pad * 2;
                var height = er.height + pad * 2;
                wrap.style.left = left + 'px';
                wrap.style.top = top + 'px';
                wrap.style.width = width + 'px';
                wrap.style.height = height + 'px';
            }
            function onMove(e) {
                var dx = e.clientX - startX;
                var dy = e.clientY - startY;
                if (isFontResize && textTarget && typeof startFontSize === 'number') {
                    // Dimensionar texto = mexe no font-size do elemento T/D (não no tamanho do anexo)
                    // Para não ficar "invertido", usamos a direção do handle (edge).
                    // - e / se / ne => aumentar com dx
                    // - w / sw / nw => diminuir com dx
                    // - s / se / sw => aumentar com dy
                    // - n / ne / nw => diminuir com dy
                    var signX = 0;
                    if (edge.indexOf('e') !== -1) signX = 1;
                    else if (edge.indexOf('w') !== -1) signX = -1;

                    var signY = 0;
                    if (edge.indexOf('s') !== -1) signY = 1;
                    else if (edge.indexOf('n') !== -1) signY = -1;

                    var delta = (signX * dx) + (signY * dy);
                    var nextFont = startFontSize + delta * 0.08;
                    nextFont = Math.max(8, Math.min(160, nextFont));
                    textTarget.style.fontSize = nextFont + 'px';
                    updateHandlesToTarget(textTarget);
                    return;
                }
                var w = startW;
                var h = startH;
                var left = startLeft;
                var top = startTop;
                if (edge.indexOf('e') !== -1) w = Math.max(BRANCH_SIZE_MIN, Math.min(BRANCH_SIZE_MAX, startW + dx));
                if (edge.indexOf('w') !== -1) {
                    w = Math.max(BRANCH_SIZE_MIN, Math.min(BRANCH_SIZE_MAX, startW - dx));
                    left = startLeft + (startW - w);
                }
                if (edge.indexOf('s') !== -1) h = Math.max(BRANCH_SIZE_MIN, Math.min(BRANCH_SIZE_MAX, startH + dy));
                if (edge.indexOf('n') !== -1) {
                    h = Math.max(BRANCH_SIZE_MIN, Math.min(BRANCH_SIZE_MAX, startH - dy));
                    top = startTop + (startH - h);
                }
                div.style.width = w + 'px';
                div.style.minHeight = h + 'px';
                div.style.left = left + 'px';
                div.style.top = top + 'px';
                div.dataset.width = String(w);
                div.dataset.height = String(h);
                div.dataset.x = String(left);
                div.dataset.y = String(top);
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (isFontResize) {
                    // Repor estilos inline (volta ao comportamento normal do layout)
                    div.style.width = prevInlineWidth;
                    div.style.minHeight = prevInlineMinHeight;
                    div.style.height = prevInlineHeight;
                    if (typeof drawMentalConnections === 'function') drawMentalConnections();
                    return;
                }
                var data = window._annotationMentalData;
                if (data && data.nodes) {
                    var id = div.dataset.id;
                    var node = data.nodes.find(function(n) { return n.id === id; });
                    if (node) {
                        node.width = parseInt(div.dataset.width, 10);
                        node.height = parseInt(div.dataset.height, 10);
                        node.x = parseInt(div.dataset.x, 10);
                        node.y = parseInt(div.dataset.y, 10);
                    }
                }
                if (typeof drawMentalConnections === 'function') drawMentalConnections();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
}

function getMentalZoom() {
    var z = window._annotationMentalZoom;
    return (typeof z === 'number' && z > 0) ? z : 1;
}

function makeMentalBranchDraggable(div, container) {
    if (!container) return;

    var MENTAL_SNAP_THRESHOLD_PX = 16; // maior tolerância para exibir guia também entre anexos
    function ensureMentalSnapGuides() {
        var wrap = document.getElementById('annotationMentalSnapGuides');
        if (wrap) return wrap;
        wrap = document.createElement('div');
        wrap.id = 'annotationMentalSnapGuides';
        wrap.style.position = 'fixed';
        wrap.style.top = '0';
        wrap.style.left = '0';
        wrap.style.width = '100vw';
        wrap.style.height = '100vh';
        wrap.style.pointerEvents = 'none';
        wrap.style.zIndex = '2500';
        wrap.style.overflow = 'visible';

        var v = document.createElement('div');
        v.id = 'annotationMentalSnapGuideV';
        v.className = 'annotation-mental-snap-guide annotation-mental-snap-guide--v';
        v.style.display = 'none';
        wrap.appendChild(v);

        var h = document.createElement('div');
        h.id = 'annotationMentalSnapGuideH';
        h.className = 'annotation-mental-snap-guide annotation-mental-snap-guide--h';
        h.style.display = 'none';
        wrap.appendChild(h);

        document.body.appendChild(wrap);
        return wrap;
    }

    function hideMentalSnapGuides() {
        var v = document.getElementById('annotationMentalSnapGuideV');
        var h = document.getElementById('annotationMentalSnapGuideH');
        if (v) v.style.display = 'none';
        if (h) h.style.display = 'none';
    }

    function updateMentalSnapGuides(screenX, screenY, showV, showH) {
        var v = document.getElementById('annotationMentalSnapGuideV');
        var h = document.getElementById('annotationMentalSnapGuideH');
        if (!v || !h) return;
        var showAny = !!(showV || showH);
        if (!showAny) {
            v.style.display = 'none';
            h.style.display = 'none';
            return;
        }
        var sx = Math.round(screenX);
        var sy = Math.round(screenY);
        if (!isFinite(sx) || !isFinite(sy)) {
            v.style.display = 'none';
            h.style.display = 'none';
            return;
        }
        // fixed no próprio elemento: evita cortes e garante linha H visível por cima do canvas
        // Traço minimalista: mais fino e menos opaco.
        var dashGradV = 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.55) 0 4px, transparent 4px 10px)';
        var dashGradH = 'repeating-linear-gradient(to right, rgba(255,255,255,0.55) 0 5px, transparent 5px 11px)';
        v.style.cssText =
            'position:fixed;pointer-events:none;z-index:2501;display:block;' +
            'left:' + sx + 'px;top:0;margin-left:-0.5px;width:1px;height:100vh;' +
            'border:none;background:' + dashGradV + ';';
        var hTop = Math.max(0, sy);
        h.style.cssText =
            'position:fixed;pointer-events:none;z-index:2502;display:block;' +
            'left:0;top:' + hTop + 'px;width:100vw;height:1px;margin:0;padding:0;border:none;' +
            'background:' + dashGradH + ';';
    }

    div.addEventListener('pointerdown', function startDrag(e) {
        /* Rato: só botão esquerdo. Toque/stylus: pointer events cobrem o telemóvel (mousedown não serve para arrastar). */
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target.closest('.annotation-mental-dropdown')) return;
        if (e.target.closest('.annotation-mental-menu-trigger')) return;
        if (e.target.closest('.annotation-mental-mode-btn')) return;
        if (e.target.closest('.annotation-mental-resize-handle')) return;
        if (e.target && (e.target.isContentEditable || e.target.closest('.annotation-mental-branch-label') || e.target.closest('.annotation-mental-branch-description-editor'))) return;

        e.preventDefault();
        e.stopPropagation();
        if (document.activeElement && div.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        if (div.setPointerCapture && e.pointerId != null) {
            try { div.setPointerCapture(e.pointerId); } catch (err) {}
        }

        var zoom = getMentalZoom();
        if (zoom <= 0) zoom = 1;

        // Inicializa guias
        ensureMentalSnapGuides();
        hideMentalSnapGuides();

        var cr = container.getBoundingClientRect();
        var dr = div.getBoundingClientRect();
        var scrollLeft = container.scrollLeft || 0;
        var scrollTop = container.scrollTop || 0;
        var startLeft = Math.round((dr.left - cr.left) / zoom) + scrollLeft;
        var startTop = Math.round((dr.top - cr.top) / zoom) + scrollTop;

        div.style.position = 'absolute';
        div.style.left = startLeft + 'px';
        div.style.top = startTop + 'px';
        div.style.transform = '';
        div.style.margin = '0';
        div.style.zIndex = '10';
        div.dataset.x = String(startLeft);
        div.dataset.y = String(startTop);

        var data = window._annotationMentalData;
        if (data && data.nodes && div.dataset.id) {
            var node = data.nodes.find(function(n) { return n.id === div.dataset.id; });
            if (node) { node.x = startLeft; node.y = startTop; }
        }

        var startMouseX = e.clientX;
        var startMouseY = e.clientY;
        var activePointerId = e.pointerId;
        div.classList.add('dragging');

        var rafId = null;
        var lastClientX = startMouseX;
        var lastClientY = startMouseY;

        function applyPosition(clientX, clientY) {
            var dx = (clientX - startMouseX) / zoom;
            var dy = (clientY - startMouseY) / zoom;

        var left = Math.round(startLeft + dx);
        var top = Math.round(startTop + dy);

        // Snap em alinhamentos tipo Canva (centros)
        var draggedId = div.dataset.id;
        var w = parseInt(div.dataset.width || div.style.width || '0', 10) || div.getBoundingClientRect().width || 140;
        var h = parseInt(div.dataset.height || div.style.minHeight || '0', 10) || div.getBoundingClientRect().height || 140;
        var centerX = left + w / 2;
        var centerY = top + h / 2;
        var leftEdge = left;
        var rightEdge = left + w;
        var topEdge = top;
        var bottomEdge = top + h;

        var snappedCenterX = null;
        var snappedCenterY = null;
        var bestDx = Infinity;
        var bestDy = Infinity;

        var contentData = window._annotationMentalData;
        var nodes = (contentData && Array.isArray(contentData.nodes)) ? contentData.nodes : [];
        nodes.forEach(function(n) {
            if (!n || n.id === draggedId) return;
            var nx = typeof n.x === 'number' ? n.x : null;
            var ny = typeof n.y === 'number' ? n.y : null;
            var nw = typeof n.width === 'number'
                ? n.width
                : (n.id === 'center'
                    ? BRANCH_CENTER_DEFAULT_WIDTH
                    : (n.shape === 'balloon' ? 220 : 140));
            var nh = typeof n.height === 'number'
                ? n.height
                : (n.id === 'center'
                    ? BRANCH_CENTER_DEFAULT_HEIGHT
                    : (n.shape === 'balloon' ? 72 : 140));
            if (nx == null || ny == null || nw == null || nh == null) return;
            var nCenterX = nx + nw / 2;
            var nCenterY = ny + nh / 2;
            var nLeft = nx;
            var nRight = nx + nw;
            var nTop = ny;
            var nBottom = ny + nh;
            var deltaX = Math.abs(centerX - nCenterX);
            if (deltaX < bestDx && deltaX <= MENTAL_SNAP_THRESHOLD_PX) {
                bestDx = deltaX;
                snappedCenterX = nCenterX;
            }
            // Snap lateral: borda esquerda/direita alinhando com outros anexos
            var deltaLeft = Math.abs(leftEdge - nLeft);
            if (deltaLeft < bestDx && deltaLeft <= MENTAL_SNAP_THRESHOLD_PX) {
                bestDx = deltaLeft;
                snappedCenterX = nLeft + w / 2;
            }
            var deltaRight = Math.abs(rightEdge - nRight);
            if (deltaRight < bestDx && deltaRight <= MENTAL_SNAP_THRESHOLD_PX) {
                bestDx = deltaRight;
                snappedCenterX = nRight - w / 2;
            }
            var deltaY = Math.abs(centerY - nCenterY);
            if (deltaY < bestDy && deltaY <= MENTAL_SNAP_THRESHOLD_PX) {
                bestDy = deltaY;
                snappedCenterY = nCenterY;
            }
            // Snap lateral horizontal: borda superior/inferior
            var deltaTop = Math.abs(topEdge - nTop);
            if (deltaTop < bestDy && deltaTop <= MENTAL_SNAP_THRESHOLD_PX) {
                bestDy = deltaTop;
                snappedCenterY = nTop + h / 2;
            }
            var deltaBottom = Math.abs(bottomEdge - nBottom);
            if (deltaBottom < bestDy && deltaBottom <= MENTAL_SNAP_THRESHOLD_PX) {
                bestDy = deltaBottom;
                snappedCenterY = nBottom - h / 2;
            }
        });

        // Snap para o "centro do canvas" (como no Canva)
        try {
            var canvas = document.getElementById('annotationMentalCanvas');
            if (canvas) {
                var canvasRect = canvas.getBoundingClientRect();
                var pan = getMentalPan();
                var screenCenterX = canvasRect.width / 2;
                var screenCenterY = canvasRect.height / 2;
                var canvasCenterContentX = (screenCenterX - pan.x) / zoom;
                var canvasCenterContentY = (screenCenterY - pan.y) / zoom;

                var deltaCX = Math.abs(centerX - canvasCenterContentX);
                if (deltaCX < bestDx && deltaCX <= MENTAL_SNAP_THRESHOLD_PX) {
                    bestDx = deltaCX;
                    snappedCenterX = canvasCenterContentX;
                }
                var deltaCY = Math.abs(centerY - canvasCenterContentY);
                if (deltaCY < bestDy && deltaCY <= MENTAL_SNAP_THRESHOLD_PX) {
                    bestDy = deltaCY;
                    snappedCenterY = canvasCenterContentY;
                }
            }
        } catch (_) {}

        if (snappedCenterX != null) left = Math.round(snappedCenterX - w / 2);
        if (snappedCenterY != null) top = Math.round(snappedCenterY - h / 2);

        div.style.left = left + 'px';
        div.style.top = top + 'px';
        div.dataset.x = String(left);
        div.dataset.y = String(top);
        if (data && data.nodes && div.dataset.id) {
            var n = data.nodes.find(function(node) { return node.id === div.dataset.id; });
            if (n) { n.x = left; n.y = top; }
        }

        // Guias: centro em ecrã do anexo *depois* do snap (alinha com o outro anexo / canvas).
        // Não usar pan+zoom+contentY — getBoundingClientRect inclui zoom, scroll e layout reais.
        if (snappedCenterX != null || snappedCenterY != null) {
            var br = div.getBoundingClientRect();
            updateMentalSnapGuides((br.left + br.right) / 2, (br.top + br.bottom) / 2, true, true);
        } else {
            hideMentalSnapGuides();
        }

            if (typeof drawMentalConnections === 'function') drawMentalConnections();
        }

        function onMove(e) {
            if (activePointerId != null && e.pointerId != null && e.pointerId !== activePointerId) return;
            e.preventDefault();
            lastClientX = e.clientX;
            lastClientY = e.clientY;
            if (rafId === null) {
                rafId = requestAnimationFrame(function() {
                    rafId = null;
                    applyPosition(lastClientX, lastClientY);
                });
            }
        }

        function onUp(e) {
            if (e && activePointerId != null && e.pointerId != null && e.pointerId !== activePointerId) return;
            document.removeEventListener('pointermove', onMove, peOpts);
            document.removeEventListener('pointerup', onUp, peOpts);
            document.removeEventListener('pointercancel', onUp, peOpts);
            var releasePid = (e && e.pointerId != null) ? e.pointerId : activePointerId;
            if (div.releasePointerCapture && releasePid != null) {
                try { div.releasePointerCapture(releasePid); } catch (err) {}
            }
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            var endX = (e && typeof e.clientX === 'number') ? e.clientX : lastClientX;
            var endY = (e && typeof e.clientY === 'number') ? e.clientY : lastClientY;
            applyPosition(endX, endY);
            hideMentalSnapGuides();
            div.classList.remove('dragging');
            div.style.zIndex = '5';
            if (typeof drawMentalConnections === 'function') drawMentalConnections();
        }

        var peOpts = { capture: true, passive: false };
        document.addEventListener('pointermove', onMove, peOpts);
        document.addEventListener('pointerup', onUp, peOpts);
        document.addEventListener('pointercancel', onUp, peOpts);
    });
}

function getAnnotationDataFromEditors() {
    const type = annotationModalContext.type;
    if (!type) return null;
    if (type === 'digitalizando') {
        const el = document.getElementById('annotationDigitalContent');
        return el ? el.innerHTML : '';
    }
    if (type === 'caderno') {
        const canvas = window._annotationCadernoCanvas;
        return canvas ? canvas.toDataURL('image/png') : '';
    }
    if (type === 'mental') {
        const data = window._annotationMentalData;
        if (!data) return null;
        const centerEl = document.getElementById('annotationMentalCenter');
        const branchesEl = document.getElementById('annotationMentalBranches');
        var nodes = [{ id: 'center', label: (centerEl && centerEl.textContent) || '', x: 150, y: 80 }];
        var nodeIds = { center: true };
        if (branchesEl) {
            branchesEl.querySelectorAll('.annotation-mental-branch').forEach(function(div) {
                var id = div.dataset.id;
                if (!id) return;
                var labelEl = div.querySelector('.annotation-mental-branch-label');
                var labelHtml = labelEl ? (labelEl.innerHTML || '') : '';
                var label = labelEl ? (labelEl.innerText || labelEl.textContent || '').trim() : '';
                var labelStyle = {};
                if (labelEl) {
                    if (labelEl.style.color) labelStyle.color = labelEl.style.color;
                    if (labelEl.style.fontSize) labelStyle.fontSize = labelEl.style.fontSize;
                    if (labelEl.style.letterSpacing) labelStyle.letterSpacing = labelEl.style.letterSpacing;
                    if (labelEl.style.lineHeight) labelStyle.lineHeight = labelEl.style.lineHeight;
                    if (labelEl.style.textIndent) labelStyle.textIndent = labelEl.style.textIndent;
                }
                var descEl = div.querySelector('.annotation-mental-branch-description-editor');
                var descriptionHtml = descEl ? (descEl.innerHTML || '') : '';
                var description = descEl ? (descEl.innerText || descEl.textContent || '').trim() : '';
                var descriptionStyle = {};
                if (descEl) {
                    if (descEl.style.color) descriptionStyle.color = descEl.style.color;
                    if (descEl.style.fontSize) descriptionStyle.fontSize = descEl.style.fontSize;
                    if (descEl.style.letterSpacing) descriptionStyle.letterSpacing = descEl.style.letterSpacing;
                    if (descEl.style.lineHeight) descriptionStyle.lineHeight = descEl.style.lineHeight;
                    if (descEl.style.textIndent) descriptionStyle.textIndent = descEl.style.textIndent;
                }
                var x = parseInt(div.dataset.x || div.style.left || '200', 10) || 200;
                var y = parseInt(div.dataset.y || div.style.top || '120', 10) || 120;
                var w = parseInt(div.dataset.width || div.style.width || '140', 10) || 140;
                var h = parseInt(div.dataset.height || div.style.minHeight || '140', 10) || 140;
                var color = (div.dataset.color && /^#[0-9a-fA-F]{3,8}$/.test(div.dataset.color)) ? div.dataset.color : undefined;
                var fontColor = (div.dataset.fontColor && /^#[0-9a-fA-F]{3,8}$/.test(div.dataset.fontColor)) ? div.dataset.fontColor : undefined;
                var nodeRef = data.nodes && data.nodes.find(function(n) { return n.id === id; });
                var imageRef = (nodeRef && nodeRef.image && nodeRef.image.attachmentId && nodeRef.image.url) ? { attachmentId: nodeRef.image.attachmentId, url: nodeRef.image.url } : undefined;
                var imageData = (nodeRef && typeof nodeRef.imageData === 'string' && nodeRef.imageData.length) ? nodeRef.imageData : undefined;

                // Se não temos `image` (referência do servidor), preservamos `imageData`
                // para não perder a imagem ao reabrir mesmo quando o upload falha/está em progresso.
                var nodePayload = {
                    id: id,
                    label: label,
                    labelHtml: labelHtml,
                    labelStyle: Object.keys(labelStyle).length ? labelStyle : undefined,
                    x: x,
                    y: y,
                    description: description,
                    descriptionHtml: descriptionHtml,
                    descriptionStyle: Object.keys(descriptionStyle).length ? descriptionStyle : undefined,
                    width: w,
                    height: h,
                    color: color,
                    fontColor: fontColor,
                    image: imageRef
                };
                if (!imageRef && imageData) nodePayload.imageData = imageData;
                nodes.push({
                    // manter objeto com a mesma estrutura anterior
                    id: nodePayload.id,
                    label: nodePayload.label,
                    labelHtml: nodePayload.labelHtml,
                    labelStyle: nodePayload.labelStyle,
                    x: nodePayload.x,
                    y: nodePayload.y,
                    description: nodePayload.description,
                    descriptionHtml: nodePayload.descriptionHtml,
                    descriptionStyle: nodePayload.descriptionStyle,
                    width: nodePayload.width,
                    height: nodePayload.height,
                    color: nodePayload.color,
                    fontColor: nodePayload.fontColor,
                    image: nodePayload.image,
                    ...(nodePayload.imageData ? { imageData: nodePayload.imageData } : {})
                });
                nodeIds[id] = true;
            });
        }
        var edges = (data.edges && data.edges.length) ? data.edges.filter(function(e) { return nodeIds[e.from] && nodeIds[e.to]; }).map(function(e) { return { from: e.from, to: e.to, type: e.type || 'hierarchical' }; }) : [];
        return JSON.stringify({ nodes: nodes, edges: edges });
    }
    return null;
}

async function saveTaskAnnotation(routineId, taskId, annotation, saveName) {
    const routine = allRoutines.find(r => r.id === routineId);
    let task = routine && routine.tasks ? routine.tasks.find(t => t.id === taskId) : null;
    const isSynthetic = !task && (taskId === routineId + '-new' || String(taskId).endsWith('-new'));
    const annotationDate = annotationModalContext.annotationDate || getLocalDateStr(new Date());
    const taskText = (annotationModalContext.task && annotationModalContext.task.text) || routine.title || 'Rotina';

    if (isSynthetic) {
        try {
            var token = localStorage.getItem('token');
            const createRes = await fetch(`${API_URL}/routines/${routineId}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
                body: JSON.stringify({ text: taskText })
            });
            if (createRes.status === 401) {
                localStorage.removeItem('token');
                localStorage.removeItem('userName');
                throw new Error('API error');
            }
            if (!createRes.ok) throw new Error('API error');
            const newTask = await createRes.json();
            taskId = newTask.id;
            if (routine) {
                if (!routine.tasks) routine.tasks = [];
                routine.tasks.push(newTask);
            }
            task = newTask;
        } catch (e) {
            var tok = localStorage.getItem('token');
            if (tok) addToSyncQueue('POST', API_URL + '/routines/' + routineId + '/tasks', JSON.stringify({ text: taskText }), { Authorization: 'Bearer ' + tok });
            const newTask = { id: Date.now().toString(), text: taskText, completed: false, annotationsByDate: {} };
            taskId = newTask.id;
            task = newTask;
            if (routine) {
                if (!routine.tasks) routine.tasks = [];
                routine.tasks.push(newTask);
            }
            try {
                const storageKey = localStorage.getItem('token') ? 'routines' : 'localRoutines';
                const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
                const ri = stored.findIndex(r => r.id === routineId);
                if (ri !== -1) {
                    if (!stored[ri].tasks) stored[ri].tasks = [];
                    stored[ri].tasks.push(newTask);
                    localStorage.setItem(storageKey, JSON.stringify(stored));
                }
            } catch (_) {}
        }
    }
    if (!task) return { savedToServer: false, was401: false };

    var name = (typeof saveName === 'string' ? saveName.trim() : '') || 'Anotação';
    task.annotation = annotation;
    if (!task.annotationsByDate || typeof task.annotationsByDate !== 'object') task.annotationsByDate = {};
    const list = getTaskAnnotationsListForDate(task, annotationDate);
    const isUpdating = annotationModalContext.viewItem && typeof annotationModalContext.viewAnnIndex === 'number' && annotationModalContext.viewAnnIndex >= 0 && annotationModalContext.viewAnnIndex < list.length;
    if (!isUpdating) {
        var existingNames = list.map(function(a) { return (a.name || '').trim().toLowerCase(); });
        var base = name;
        var num = 1;
        while (existingNames.indexOf(name.trim().toLowerCase()) !== -1) {
            num++;
            name = base + ' (' + num + ')';
        }
    }
    const namedEntry = { name: name, type: annotation.type || '', data: annotation.data != null ? annotation.data : '', lastUpdated: new Date().toISOString() };
    if (isUpdating) {
        list[annotationModalContext.viewAnnIndex] = namedEntry;
        annotationModalContext.viewItem = null;
        annotationModalContext.viewAnnIndex = undefined;
    } else {
        list.push(namedEntry);
    }
    task.annotationsByDate[annotationDate] = list;

    try {
        var token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/routines/${routineId}/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: JSON.stringify({
                text: task.text,
                completed: task.completed,
                annotation,
                annotationDate,
                annotationsByDate: task.annotationsByDate
            })
        });
        if (res.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('userName');
            showToast('Sessão expirada. Os dados foram guardados localmente. Inicie sessão novamente para sincronizar.', 6000);
            try {
                var storageKey = 'localRoutines';
                var stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
                var ri = stored.findIndex(function(r) { return r.id === routineId; });
                if (ri !== -1) {
                    var ti = stored[ri].tasks ? stored[ri].tasks.findIndex(function(t) { return t.id === taskId; }) : -1;
                    if (ti !== -1) {
                        if (!stored[ri].tasks[ti].annotationsByDate) stored[ri].tasks[ti].annotationsByDate = {};
                        stored[ri].tasks[ti].annotationsByDate[annotationDate] = task.annotationsByDate[annotationDate];
                        stored = stripBase64FromRoutines(stored);
                        localStorage.setItem(storageKey, JSON.stringify(stored));
                    }
                }
            } catch (_) {}
            if (typeof renderAgenda === 'function') renderAgenda();
            return { savedToServer: false, was401: true };
        }
        if (!res.ok) {
            if (res.status >= 500) {
                var tok = localStorage.getItem('token');
                if (tok) addToSyncQueue('PUT', API_URL + '/routines/' + routineId + '/tasks/' + taskId, JSON.stringify({ text: task.text, completed: task.completed, annotation: annotation, annotationDate: annotationDate, annotationsByDate: task.annotationsByDate }), { Authorization: 'Bearer ' + tok });
            }
            throw new Error('API error');
        }
        // Backup no localStorage mesmo com API ok (evita perder anotações ao atualizar)
        try {
            const storageKey = 'localRoutines';
            var stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
            const ri = stored.findIndex(r => r.id === routineId);
            if (ri !== -1) {
                const ti = stored[ri].tasks ? stored[ri].tasks.findIndex(t => t.id === taskId) : -1;
                if (ti !== -1) {
                    if (!stored[ri].tasks[ti].annotationsByDate) stored[ri].tasks[ti].annotationsByDate = {};
                    stored[ri].tasks[ti].annotationsByDate[annotationDate] = task.annotationsByDate[annotationDate];
                    stored = stripBase64FromRoutines(stored);
                    localStorage.setItem(storageKey, JSON.stringify(stored));
                }
            }
        } catch (_) {}
        if (typeof renderAgenda === 'function') renderAgenda();
        return { savedToServer: true, was401: false };
    } catch (e) {
        var tok = localStorage.getItem('token');
        if (tok) addToSyncQueue('PUT', API_URL + '/routines/' + routineId + '/tasks/' + taskId, JSON.stringify({ text: task.text, completed: task.completed, annotation: annotation, annotationDate: annotationDate, annotationsByDate: task.annotationsByDate }), { Authorization: 'Bearer ' + tok });
        try {
            const storageKey = localStorage.getItem('token') ? 'routines' : 'localRoutines';
            var stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
            const ri = stored.findIndex(r => r.id === routineId);
            if (ri !== -1) {
                const ti = stored[ri].tasks ? stored[ri].tasks.findIndex(t => t.id === taskId) : -1;
                if (ti !== -1) {
                    stored[ri].tasks[ti].annotation = annotation;
                    if (!stored[ri].tasks[ti].annotationsByDate) stored[ri].tasks[ti].annotationsByDate = {};
                    stored[ri].tasks[ti].annotationsByDate[annotationDate] = task.annotationsByDate[annotationDate];
                    stored = stripBase64FromRoutines(stored);
                    localStorage.setItem(storageKey, JSON.stringify(stored));
                }
            }
        } catch (_) {}
    }
    if (typeof renderAgenda === 'function') renderAgenda();
    return { savedToServer: false, was401: false };
}

function shouldShowDailyOnboarding() {
    try {
        var overlay = document.getElementById('dailyOnboardingOverlay');
        if (!overlay) return false;
        var todayStr = getLocalDateStr(new Date());
        var key = 'ecRoutineDailyOnboardingLastSeenDate';
        var last = localStorage.getItem(key);
        return last !== todayStr;
    } catch (e) {
        return false;
    }
}

function setDailyOnboardingStep(stepNum) {
    try {
        var overlay = document.getElementById('dailyOnboardingOverlay');
        if (!overlay) return;
        var steps = overlay.querySelectorAll('.daily-onboarding-step[data-step]');
        steps.forEach(function(s) {
            var sn = parseInt(s.dataset.step || '0', 10);
            if (sn === stepNum) s.classList.add('is-active');
            else s.classList.remove('is-active');
        });
        var dots = overlay.querySelectorAll('.daily-onboarding-dot[data-dot]');
        dots.forEach(function(d) {
            var dn = parseInt(d.dataset.dot || '0', 10);
            var isActive = dn === stepNum;
            if (isActive) d.classList.add('is-active');
            else d.classList.remove('is-active');
        });
    } catch (e) {}
}

function showDailyOnboardingOverlay() {
    try {
        var overlay = document.getElementById('dailyOnboardingOverlay');
        if (!overlay) return;
        overlay.classList.add('is-visible');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        setDailyOnboardingStep(1);
    } catch (e) {}
}

function hideDailyOnboardingOverlay() {
    return new Promise(function(resolve) {
        try {
            var overlay = document.getElementById('dailyOnboardingOverlay');
            if (!overlay) {
                try { document.body.style.overflow = ''; } catch (_) {}
                resolve();
                return;
            }
            if (!overlay.classList.contains('is-visible')) {
                try { document.body.style.overflow = ''; } catch (_) {}
                resolve();
                return;
            }
            var done = false;
            function finish() {
                if (done) return;
                done = true;
                try {
                    overlay.removeEventListener('transitionend', onEnd);
                } catch (_) {}
                try { document.body.style.overflow = ''; } catch (_) {}
                resolve();
            }
            function onEnd(e) {
                if (e && e.target === overlay && e.propertyName === 'opacity') finish();
            }
            overlay.addEventListener('transitionend', onEnd);
            overlay.classList.remove('is-visible');
            overlay.setAttribute('aria-hidden', 'true');
            setTimeout(finish, 950);
        } catch (e) {
            try { document.body.style.overflow = ''; } catch (_) {}
            resolve();
        }
    });
}

function getRoutineTimeMin(routine) {
    const t = routine && routine.schedule ? routine.schedule.time : null;
    if (!t || typeof t !== 'string') return null;
    const parts = t.split(':').map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    return parts[0] * 60 + parts[1];
}

function statusForDailyOnboardingRoutine(r, completedTodaySet, currentTimeMin) {
    if (completedTodaySet.has(r.id)) return { status: 'done', label: 'Concluída' };
    const routineMin = getRoutineTimeMin(r);
    if (routineMin != null) {
        if (currentTimeMin >= routineMin - 15 && currentTimeMin <= routineMin + 60) return { status: 'progress', label: 'Em andamento' };
    }
    return { status: 'pending', label: 'Pendente' };
}

function priorityRankForDailyOnboardingRoutine(r, completedTodaySet, currentTimeMin, windowEndMin) {
    if (completedTodaySet.has(r.id)) return 4; // concluídas no final
    if (r.bulletType === 'important') return 0; // importante primeiro
    const routineMin = getRoutineTimeMin(r);
    if (routineMin != null && routineMin >= currentTimeMin && routineMin <= windowEndMin) return 1; // urgentes próximas 2h
    if (routineMin != null) return 2; // com horário (depois urgentes)
    return 3; // sem horário (por último)
}

function renderDailyOnboardingTasksForTodayByPriority() {
    try {
        const list = document.getElementById('dailyOnboardingTasksList');
        if (!list) return;

        const todayStr = getLocalDateStr(new Date());
        const now = new Date();
        const currentTimeMin = now.getHours() * 60 + now.getMinutes();
        const windowEndMin = currentTimeMin + 120;

        const routinesToday = (allRoutines || []).filter(r => isRoutineDate(todayStr, r));
        const completedTodaySet = new Set(routinesToday.filter(r => getRoutineCompletedDates(r).has(todayStr)).map(r => r.id));

        if (!routinesToday.length) {
            list.innerHTML = '<p class="daily-onboarding-empty">Nenhuma rotina hoje.</p>';
            return;
        }

        // Ordenação "por importância" (tipo Canva):
        // 1) Importantes sempre no topo (mesmo se já concluídas)
        // 2) Depois, concluídas no final do grupo (pendentes primeiro)
        // 3) Dentro do grupo, "Em andamento" (janela -15min a +60min) e depois horário mais cedo
        const sorted = routinesToday.slice().sort(function(a, b) {
            const aImportant = (a.bulletType || 'task') === 'important';
            const bImportant = (b.bulletType || 'task') === 'important';
            if (aImportant !== bImportant) return aImportant ? -1 : 1;

            const aDone = completedTodaySet.has(a.id);
            const bDone = completedTodaySet.has(b.id);
            if (aDone !== bDone) return aDone ? 1 : -1;

            const aTime = getRoutineTimeMin(a);
            const bTime = getRoutineTimeMin(b);
            const aProgress = aTime != null ? (currentTimeMin >= aTime - 15 && currentTimeMin <= aTime + 60) : false;
            const bProgress = bTime != null ? (currentTimeMin >= bTime - 15 && currentTimeMin <= bTime + 60) : false;
            if (aProgress !== bProgress) return aProgress ? -1 : 1;

            if (aTime == null && bTime != null) return 1;
            if (bTime == null && aTime != null) return -1;
            if (aTime != null && bTime != null && aTime !== bTime) return aTime - bTime;

            return String(a.title || '').localeCompare(String(b.title || ''));
        });

        var maxItems = 12;
        var items = sorted.slice(0, maxItems);

        list.innerHTML = items.map(function(r) {
            const status = statusForDailyOnboardingRoutine(r, completedTodaySet, currentTimeMin);
            const isImportant = r.bulletType === 'important';
            const t = r.schedule && r.schedule.time ? r.schedule.time : '';
            const timeLabel = t ? t : 'Sem horário';
            var badgesHtml = '';
            if (isImportant) {
                badgesHtml += '<span class="daily-onboarding-badge daily-onboarding-badge--important">Importante</span>';
            }
            badgesHtml += '<span class="daily-onboarding-badge daily-onboarding-badge--' + escapeHtml(status.status) + '">' + escapeHtml(status.label) + '</span>';
            return ''
                + '<div class="daily-onboarding-task-row">'
                + '  <div class="daily-onboarding-task-left">'
                + '    <div class="daily-onboarding-task-title">' + escapeHtml(r.title || 'Rotina') + '</div>'
                + '    <div class="daily-onboarding-task-time">' + escapeHtml(timeLabel) + '</div>'
                + '  </div>'
                + '  <div class="daily-onboarding-badges">' + badgesHtml + '</div>'
                + '</div>';
        }).join('');
    } catch (e) {}
}

function setPostLoginWelcomeStep(stepNum) {
    try {
        var overlay = document.getElementById('postLoginWelcomeOverlay');
        if (!overlay) return;
        var steps = overlay.querySelectorAll('.daily-onboarding-step[data-step]');
        steps.forEach(function (s) {
            var sn = parseInt(s.dataset.step || '0', 10);
            if (sn === stepNum) s.classList.add('is-active');
            else s.classList.remove('is-active');
        });
    } catch (e) {}
}

function showPostLoginWelcomeOverlay() {
    try {
        var overlay = document.getElementById('postLoginWelcomeOverlay');
        if (!overlay) return;
        overlay.classList.add('is-visible');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        setPostLoginWelcomeStep(1);
    } catch (e) {}
}

function hidePostLoginWelcomeOverlay() {
    return new Promise(function (resolve) {
        try {
            var overlay = document.getElementById('postLoginWelcomeOverlay');
            if (!overlay) {
                try {
                    document.body.style.overflow = '';
                } catch (_) {}
                resolve();
                return;
            }
            if (!overlay.classList.contains('is-visible')) {
                try {
                    document.body.style.overflow = '';
                } catch (_) {}
                resolve();
                return;
            }
            var done = false;
            function finish() {
                if (done) return;
                done = true;
                try {
                    overlay.removeEventListener('transitionend', onEnd);
                } catch (_) {}
                try {
                    document.body.style.overflow = '';
                } catch (_) {}
                resolve();
            }
            function onEnd(e) {
                if (e && e.target === overlay && e.propertyName === 'opacity') finish();
            }
            overlay.addEventListener('transitionend', onEnd);
            overlay.classList.remove('is-visible');
            overlay.setAttribute('aria-hidden', 'true');
            setTimeout(finish, 950);
        } catch (e) {
            try {
                document.body.style.overflow = '';
            } catch (_) {}
            resolve();
        }
    });
}

/** Após login sem rotinas: passos iguais à apresentação diária → redireciona para criar primeira tarefa */
async function runPostLoginWelcomeOnboarding() {
    var dash = document.getElementById('dashboardOverview');
    var rot = document.getElementById('rotinasView');
    if (dash && dash.classList) dash.classList.add('hidden');
    if (rot && rot.classList) rot.classList.add('hidden');

    var STEP_MS = 2700;
    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    showPostLoginWelcomeOverlay();
    setPostLoginWelcomeStep(1);
    await sleep(STEP_MS);
    setPostLoginWelcomeStep(2);
    await sleep(STEP_MS);

    await hidePostLoginWelcomeOverlay();
    window.location.href = '/create';
    return true;
}

async function runDailyOnboarding() {
    if (!shouldShowDailyOnboarding()) return false;
    // Marca imediatamente para garantir "1x por dia" mesmo que a navegação/fecho aconteça antes do overlay terminar.
    try {
        localStorage.setItem('ecRoutineDailyOnboardingLastSeenDate', getLocalDateStr(new Date()));
    } catch (e) {}
    var dashboardOverview = document.getElementById('dashboardOverview');
    var rotinasView = document.getElementById('rotinasView');
    if (dashboardOverview && dashboardOverview.classList) dashboardOverview.classList.add('hidden');
    if (rotinasView && rotinasView.classList) rotinasView.classList.add('hidden');

    var STEP_MS = 2700;
    function sleep(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }

    showDailyOnboardingOverlay();
    setDailyOnboardingStep(1);
    await sleep(STEP_MS);
    setDailyOnboardingStep(2);
    // Adia render pesado para o próximo frame, evitando micro-travada na troca de passo.
    await new Promise(function(resolve) {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function() {
                renderDailyOnboardingTasksForTodayByPriority();
                resolve();
            });
            return;
        }
        setTimeout(function() {
            renderDailyOnboardingTasksForTodayByPriority();
            resolve();
        }, 16);
    });
    await sleep(STEP_MS);

    if (dashboardOverview && dashboardOverview.classList) {
        dashboardOverview.classList.remove('hidden');
        dashboardOverview.classList.add('dashboard-overview--reveal-after-onboarding');
        var stripReveal = function() {
            try {
                dashboardOverview.classList.remove('dashboard-overview--reveal-after-onboarding');
            } catch (_) {}
        };
        dashboardOverview.addEventListener('animationend', stripReveal, { once: true });
        setTimeout(stripReveal, 1000);
    }
    await hideDailyOnboardingOverlay();
    try {
        localStorage.setItem('ecRoutineDailyOnboardingLastSeenDate', getLocalDateStr(new Date()));
    } catch (e) {}
    return true;
}

function setupAnnotationModal() {
    const modal = document.getElementById('annotationModal');
    const overlay = modal && modal.querySelector('.annotation-modal-overlay');
    const closeBtn = document.getElementById('annotationModalClose');
    const cancelBtn = document.getElementById('annotationBtnCancel');
    const saveBtn = document.getElementById('annotationBtnSave');
    function confirmCloseWithoutSaving() {
        if (!modal || modal.classList.contains('hidden')) return true;
        return confirm('Deseja sair sem salvar?');
    }
    [overlay, closeBtn, cancelBtn].forEach(el => {
        if (!el) return;
        el.addEventListener('click', function() {
            if (!confirmCloseWithoutSaving()) return;
            closeAnnotationModal();
        });
    });
    if (saveBtn) {
        saveBtn.addEventListener('click', async function() {
            const type = annotationModalContext.type;
            showAnnotationSavingOverlay('Salvando…');
            if (type === 'mental') {
                // Primeiro: garante que uploads iniciados durante a edição terminaram.
                await waitForMentalImageUploads();
                // Segundo: migração de base64 legado (casos antigos sem referência de anexo).
                if (typeof uploadLegacyBase64InMental === 'function') await uploadLegacyBase64InMental();
            }
            const data = getAnnotationDataFromEditors();
            if (!type) { closeAnnotationModal(); return; }
            var suggestedName = '';
            if (annotationModalContext.viewItem && annotationModalContext.viewItem.annotations && typeof annotationModalContext.viewAnnIndex === 'number') {
                var ann = annotationModalContext.viewItem.annotations[annotationModalContext.viewAnnIndex];
                if (ann && ann.name) suggestedName = ann.name;
            }
            if (!suggestedName && annotationModalContext.task && annotationModalContext.annotationDate) {
                var listForDate = getTaskAnnotationsListForDate(annotationModalContext.task, annotationModalContext.annotationDate);
                if (listForDate && listForDate.length > 0) suggestedName = listForDate[listForDate.length - 1].name || '';
            }
            var saveName = prompt('Qual nome será esta anotação?', suggestedName);
            if (saveName === null) return;
            saveName = (typeof saveName === 'string' && saveName.trim()) ? saveName.trim() : (suggestedName || 'Anotação');
            const annotationDate = annotationModalContext.annotationDate || getLocalDateStr(new Date());
            if (saveBtn) {
                saveBtn.disabled = true;
                var saveBtnText = saveBtn.textContent;
                saveBtn.textContent = 'A guardar…';
            }
            var saveResult = null;
            try {
                saveResult = await saveTaskAnnotation(annotationModalContext.routineId, annotationModalContext.taskId, { type, data: data != null ? data : '' }, saveName);
            } finally {
                hideAnnotationSavingOverlay();
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Salvar';
                }
            }
            const todayStr = getLocalDateStr(new Date());
            if (saveResult && saveResult.savedToServer) {
                showSavedMessage(annotationDate === todayStr);
            } else if (saveResult && !saveResult.was401) {
                showToast('Guardado localmente (sem ligação ao servidor).', 4000);
            }
            closeAnnotationModal();
            if (typeof showRotinasView === 'function') showRotinasView();
            if (typeof switchRotinasView === 'function') switchRotinasView('biblioteca');
        });
    }
    if (modal) {
        modal.addEventListener('click', function(e) {
            var addChildBtn = e.target.closest('.annotation-mental-add-child');
            if (addChildBtn && addChildBtn.dataset.parentId) {
                e.preventDefault();
                e.stopPropagation();
                window._annotationMentalPendingParentId = addChildBtn.dataset.parentId;
                showMentalAddPreview();
                return;
            }
            var addBranchBtn = e.target.closest('#annotationMentalAddBranch');
            if (addBranchBtn) {
                e.preventDefault();
                e.stopPropagation();
                showMentalAddPreview();
                return;
            }
            var previewConfirm = e.target.closest('#annotationMentalPreviewConfirm');
            if (previewConfirm) {
                e.preventDefault();
                e.stopPropagation();
                confirmMentalAddPreview();
                return;
            }
            var previewCancel = e.target.closest('#annotationMentalPreviewCancel');
            if (previewCancel) {
                e.preventDefault();
                e.stopPropagation();
                hideMentalAddPreview();
                return;
            }
            var spacingBtn = e.target.closest('.annotation-mental-text-config-spacing');
            if (spacingBtn && annotationModalContext.type === 'mental') {
                e.preventDefault();
                e.stopPropagation();
                var target = window._annotationMentalTextConfigTarget || document.activeElement;
                if (target && (target.isContentEditable || target.contentEditable === 'true')) {
                    showMentalTextSpacingPanel(target);
                }
                return;
            }
            var textConfigBtn = e.target.closest('.annotation-mental-text-config-btn');
            if (textConfigBtn && annotationModalContext.type === 'mental') {
                e.preventDefault();
                var cmd = textConfigBtn.getAttribute('data-cmd');
                var value = textConfigBtn.getAttribute('data-value') || undefined;
                var target = window._annotationMentalTextConfigTarget || document.activeElement;
                // Normalizar comandos / valores para o Edge/Chrome serem consistentes
                if (cmd === 'formatBlock') {
                    if (typeof value === 'string' && value.trim()) {
                        // Alguns browsers exigem <p> ao invés de 'p'
                        if (value.indexOf('<') === -1) value = '<' + value.trim() + '>';
                    } else {
                        value = '<p>';
                    }
                }

                function placeCaretAtEnd(el) {
                    try {
                        el.focus();
                        var range = document.createRange();
                        range.selectNodeContents(el);
                        range.collapse(false);
                        var sel = window.getSelection();
                        if (sel) {
                            sel.removeAllRanges();
                            sel.addRange(range);
                        }
                    } catch (err) {}
                }

                var isEditable = target && (target.isContentEditable || target.contentEditable === 'true');
                if (isEditable) {
                    placeCaretAtEnd(target);
                    document.execCommand(cmd, false, value);
                    return;
                }
                // Fallback: tenta no contentEditable ativo
                var ae = document.activeElement;
                if (ae && (ae.isContentEditable || ae.contentEditable === 'true')) {
                    placeCaretAtEnd(ae);
                    document.execCommand(cmd, false, value);
                }
                return;
            }
            const card = e.target.closest('.annotation-preview-card');
            if (!card) return;
            const type = (card.dataset && card.dataset.type) ? String(card.dataset.type).trim() : '';
            if (!type) return;
            e.preventDefault();
            e.stopPropagation();
            showAnnotationEditor(type);
        });
    }
    var previewInput = document.getElementById('annotationMentalAddPreviewInput');
    if (previewInput) {
        previewInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmMentalAddPreview();
            }
        });
    }
    var previewConfirmBtn = document.getElementById('annotationMentalPreviewConfirm');
    if (previewConfirmBtn) {
        previewConfirmBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            confirmMentalAddPreview();
        });
    }
    var addBranchBtn = document.getElementById('annotationMentalAddBranch');
    if (addBranchBtn) {
        addBranchBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            showMentalAddPreview();
        });
    }
    var addBalloonBtn = document.getElementById('annotationMentalAddBalloon');
    if (addBalloonBtn) {
        addBalloonBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            addMentalTextBalloon();
        });
    }
    var exportSvgBtn = document.getElementById('annotationMentalExportSvg');
    if (exportSvgBtn) {
        exportSvgBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof MentalDiagramSvgExport === 'undefined') {
                showToast('Exportação SVG indisponível.');
                return;
            }
            var nameBase = 'diagrama-mental';
            if (annotationModalContext && annotationModalContext.task && annotationModalContext.task.text) {
                nameBase = sanitizeDownloadBasename(String(annotationModalContext.task.text).trim() || nameBase);
            }
            MentalDiagramSvgExport.exportFromLiveEditor(nameBase)
                .then(function() {
                    showToast('SVG descarregado.');
                })
                .catch(function(err) {
                    showToast((err && err.message) || 'Não foi possível exportar SVG.');
                });
        });
    }
    document.querySelectorAll('.annotation-tool-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const cmd = btn.dataset.cmd;
            const el = document.getElementById('annotationDigitalContent');
            if (!el) return;
            document.execCommand(cmd === 'highlight' ? 'backColor' : 'underline', false, cmd === 'highlight' ? '#ffff00' : null);
            el.focus();
        });
    });

    // Fechar configurações de texto quando clicar em outro local
    setupMentalTextConfigOutsideClickClose();
}

// ==================== SISTEMA DE NOTIFICAÇÕES ====================

let timeCheckInterval = null;

// Limpar notificações antigas do localStorage
function cleanOldNotifications() {
    const today = getLocalDateStr(new Date());
    const keysToRemove = [];
    
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('notificationShown_')) {
            // Extrair data do formato notificationShown_routineId_date
            // A data está no final, após o último underscore
            const lastUnderscore = key.lastIndexOf('_');
            if (lastUnderscore > 0) {
                const date = key.substring(lastUnderscore + 1);
                if (date !== today && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    keysToRemove.push(key);
                }
            }
        }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
}

// Iniciar verificação de horários
function startTimeChecker() {
    // Limpar notificações antigas
    cleanOldNotifications();
    
    // Verificar imediatamente
    checkRoutineTimes();
    
    // Verificar a cada minuto
    timeCheckInterval = setInterval(() => {
        checkRoutineTimes();
    }, 60000); // 60000ms = 1 minuto
}

// Limpar intervalo quando página for fechada
window.addEventListener('beforeunload', () => {
    if (timeCheckInterval) {
        clearInterval(timeCheckInterval);
    }
});

// Recarregar rotinas ao voltar ao dashboard (outra aba marcou conclusão, ou bfcache)
var _ecDashboardReloadTimer = null;
function scheduleDashboardDataRefresh() {
    if (!document.getElementById('dashboardProgressContent') && !document.getElementById('rotinasView')) return;
    clearTimeout(_ecDashboardReloadTimer);
    _ecDashboardReloadTimer = setTimeout(function () {
        _ecDashboardReloadTimer = null;
        if (typeof loadRoutines === 'function') loadRoutines();
    }, 150);
}

try {
    var ecRoutineSyncChannel = new BroadcastChannel('ec-routine-sync');
    ecRoutineSyncChannel.onmessage = function () {
        scheduleDashboardDataRefresh();
    };
} catch (_e) { /* ignore */ }

window.addEventListener('storage', function (e) {
    if (e.key === 'localRoutines') {
        scheduleDashboardDataRefresh();
    }
});

window.addEventListener('pageshow', function (ev) {
    if (ev.persisted && typeof loadRoutines === 'function' && (document.getElementById('dashboardProgressContent') || document.getElementById('rotinasView'))) {
        loadRoutines();
    }
});

// Verificar quando página volta ao foco (Page Visibility API)
var _lastVisibilityReload = 0;
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        checkRoutineTimes();
        if (document.getElementById('dashboardProgressContent') || document.getElementById('rotinasView')) {
            var n = Date.now();
            if (n - _lastVisibilityReload > 1500) {
                _lastVisibilityReload = n;
                if (typeof loadRoutines === 'function') loadRoutines();
            }
        }
    }
});

// Verificar horários das rotinas
function checkRoutineTimes() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = getLocalDateStr(now);

    // Verificar todas as rotinas
    allRoutines.forEach(routine => {
        if (!routine.schedule || !routine.schedule.time) {
            return; // Rotina sem horário agendado
        }

        const scheduledTime = routine.schedule.time;
        
        // Verificar se o horário atual corresponde (tolerância de ±1 minuto)
        if (isTimeMatch(currentTime, scheduledTime)) {
            // Verificar se já foi mostrada notificação hoje
            const notificationKey = `notificationShown_${routine.id}_${today}`;
            if (localStorage.getItem(notificationKey)) {
                return; // Já foi mostrada hoje
            }

            // Verificar se já foi feito check-in hoje
            if (routine.checkIns && routine.checkIns.includes(today)) {
                return; // Já foi feito check-in hoje
            }

            // Mostrar notificação
            showNotification(routine);
        }
    });
}

// Verificar se horário atual corresponde ao agendado (tolerância ±1 minuto)
function isTimeMatch(currentTime, scheduledTime) {
    const [currentHour, currentMin] = currentTime.split(':').map(Number);
    const [scheduledHour, scheduledMin] = scheduledTime.split(':').map(Number);
    
    const currentTotalMinutes = currentHour * 60 + currentMin;
    const scheduledTotalMinutes = scheduledHour * 60 + scheduledMin;
    
    // Tolerância de ±1 minuto
    const diff = Math.abs(currentTotalMinutes - scheduledTotalMinutes);
    return diff <= 1;
}

// Mostrar notificação
function showNotification(routine) {
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    // Verificar se já existe notificação para esta rotina
    const existingNotification = container.querySelector(`[data-routine-id="${routine.id}"]`);
    if (existingNotification) {
        return; // Já existe notificação para esta rotina
    }

    const notificationHTML = `
        <div class="notification-modal" data-routine-id="${routine.id}">
            <div class="notification-content">
                <p class="notification-question">Foi para <strong>${escapeHtml(routine.title)}</strong>?</p>
                <div class="notification-buttons">
                    <button class="notification-confirm" onclick="handleNotificationConfirm('${routine.id}')">V</button>
                    <button class="notification-cancel" onclick="handleNotificationCancel('${routine.id}')">×</button>
                </div>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', notificationHTML);

    // Registrar que notificação foi mostrada
    const today = getLocalDateStr(new Date());
    const notificationKey = `notificationShown_${routine.id}_${today}`;
    localStorage.setItem(notificationKey, 'true');
}

// Confirmar notificação (marcar check-in) - Função global
window.handleNotificationConfirm = async function(routineId) {
    const routine = allRoutines.find(r => r.id === routineId);
    if (!routine) return;

    const today = getLocalDateStr(new Date());
    
    // Adicionar hoje às completedDates de cada tarefa
    let needsSave = false;
    if (routine.tasks) {
        routine.tasks.forEach(task => {
            if (!task.completedDates) task.completedDates = [];
            if (!task.completedDates.includes(today)) {
                task.completedDates.push(today);
                task.completedDates.sort();
                needsSave = true;
            }
        });
        routine.tasks.forEach(t => { t.completed = true; }); // Marcar todas como completas
    }
    
    // Garantir que checkIns existe (compatibilidade)
    if (!routine.checkIns) {
        routine.checkIns = [];
    }
    if (!routine.checkIns.includes(today)) {
        routine.checkIns.push(today);
        routine.checkIns.sort();
        needsSave = true;
    }

    if (!needsSave) {
        closeNotification(routineId);
        return;
    }

    routine.progress = calculateProgress(routine);

    // Salvar no servidor (PUT atualiza routine com tasks.completedDates)
    const token = localStorage.getItem('token');
    if (token) {
        try {
            await apiRequest(`/routines/${routineId}`, {
                method: 'PUT',
                body: JSON.stringify(routine)
            });
        } catch (error) {
            console.log('Erro ao salvar no servidor, salvando localmente');
        }
    }
    
    // Espelhar no localStorage (upsert — igual ao detalhe da rotina)
    let routines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
    const index = routines.findIndex(r => r.id === routineId);
    if (index !== -1) {
        routines[index] = routine;
    } else {
        routines.push(routine);
    }
    routines = stripBase64FromRoutines(routines);
    localStorage.setItem('localRoutines', JSON.stringify(routines));

    try {
        var _ecNotifyCh = new BroadcastChannel('ec-routine-sync');
        _ecNotifyCh.postMessage({ type: 'routines-updated' });
        _ecNotifyCh.close();
    } catch (_e) { /* ignore */ }

    // Atualizar allRoutines
    const routineIndex = allRoutines.findIndex(r => r.id === routineId);
    if (routineIndex !== -1) {
        allRoutines[routineIndex] = routine;
    }

    // Fechar notificação
    closeNotification(routineId);

    // Recarregar rotinas
    await loadRoutines();
}

// Marcar rotina como incompleta hoje (sem horário fixo: botão "Tarefa incompleta")
async function markRoutineIncompleteForToday(routineId) {
    const routine = allRoutines.find(r => r.id === routineId);
    if (!routine) return;

    const today = getLocalDateStr(new Date());
    let needsSave = false;

    if (routine.tasks) {
        routine.tasks.forEach(task => {
            if (task.completedDates && task.completedDates.includes(today)) {
                task.completedDates = task.completedDates.filter(d => d !== today);
                task.completed = false;
                needsSave = true;
            }
        });
    }
    if (routine.checkIns && routine.checkIns.includes(today)) {
        routine.checkIns = routine.checkIns.filter(d => d !== today);
        needsSave = true;
    }

    if (!needsSave) return;

    routine.progress = calculateProgress(routine);

    const token = localStorage.getItem('token');
    if (token) {
        try {
            await apiRequest(`/routines/${routineId}`, {
                method: 'PUT',
                body: JSON.stringify(routine)
            });
        } catch (err) {
            console.log('Erro ao salvar no servidor, salvando localmente');
        }
    }
    let routines = JSON.parse(localStorage.getItem('localRoutines') || '[]');
    const index = routines.findIndex(r => r.id === routineId);
    if (index !== -1) {
        routines[index] = routine;
    } else {
        routines.push(routine);
    }
    routines = stripBase64FromRoutines(routines);
    localStorage.setItem('localRoutines', JSON.stringify(routines));
    try {
        var _ecNotifyCh2 = new BroadcastChannel('ec-routine-sync');
        _ecNotifyCh2.postMessage({ type: 'routines-updated' });
        _ecNotifyCh2.close();
    } catch (_e) { /* ignore */ }
    const routineIndex = allRoutines.findIndex(r => r.id === routineId);
    if (routineIndex !== -1) allRoutines[routineIndex] = routine;
    await loadRoutines();
}

// Cancelar notificação - Função global
window.handleNotificationCancel = function(routineId) {
    closeNotification(routineId);
    // Notificação já foi registrada como vista, então não será mostrada novamente hoje
}

// Fechar notificação
function closeNotification(routineId) {
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    const notification = container.querySelector(`[data-routine-id="${routineId}"]`);
    if (!notification) return;

    // Adicionar classe de animação de saída
    notification.classList.add('closing');

    // Remover após animação
    setTimeout(() => {
        notification.remove();
    }, 300);
}

// Modal de Mês Ampliado (ao clicar em um dia do heatmap)
function showMonthAmplifiedModal(dateStr, routine) {
    const modal = document.getElementById('dayInfoModal');
    const dateElement = document.getElementById('dayInfoDate');
    const gridElement = document.getElementById('monthAmplifiedGrid');
    
    if (!modal || !dateElement || !gridElement) return;
    
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    
    const allCheckIns = getRoutineCompletedDates(routine);
    const monthData = generateMonthCalendar(year, month, allCheckIns, routine);
    
    dateElement.textContent = monthData.monthName;
    
    const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    const weekdaysHTML = weekdays.map(d => `<div class="month-amplified-weekday">${d}</div>`).join('');
    
    const daysHTML = monthData.weeks.map(week => {
        return week.map(dayData => {
            if (dayData === null) {
                return '<div class="month-amplified-square empty"></div>';
            }
            const classes = ['month-amplified-square'];
            if (dayData.routineDay) classes.push('routine-day');
            if (dayData.checked) classes.push('checked');
            return `<div class="${classes.join(' ')}">${dayData.day}</div>`;
        }).join('');
    }).join('');
    
    gridElement.innerHTML = `<div class="month-amplified-weekdays">${weekdaysHTML}</div><div class="month-amplified-days">${daysHTML}</div>`;
    
    modal.classList.add('active');
    
    const closeBtn = document.getElementById('dayInfoClose');

    if (closeBtn) closeBtn.onclick = closeDayInfoModal;
    
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            closeDayInfoModal();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

function closeDayInfoModal() {
    const modal = document.getElementById('dayInfoModal');
    if (modal) {
        modal.classList.remove('active');
    }
}
