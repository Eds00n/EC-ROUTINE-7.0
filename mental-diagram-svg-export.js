/**
 * EC ROUTINE — Exportação SVG do diagrama mental (mapa de anexos).
 * SVG autónomo: sem CSS externo, sem JS embutido, sem fontes remotas.
 * Vista = viewport visível do canvas (igual ao ecrã), com fundo pontilhado em <pattern>.
 */
(function (global) {
    'use strict';

    var NS = 'http://www.w3.org/2000/svg';

    var FONT_STACK = 'Arial, Helvetica, sans-serif';

    function escapeXml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function escapeXmlAttr(s) {
        return escapeXml(s).replace(/\r?\n/g, ' ');
    }

    function screenToContent(canvasRect, pan, zoom, screenX, screenY) {
        var z = zoom > 0 ? zoom : 1;
        return {
            x: (screenX - canvasRect.left - pan.x) / z,
            y: (screenY - canvasRect.top - pan.y) / z
        };
    }

    function elementContentBounds(canvasEl, el, pan, zoom) {
        if (!el || typeof el.getBoundingClientRect !== 'function') return null;
        var r = el.getBoundingClientRect();
        var c = canvasEl.getBoundingClientRect();
        var p = pan || { x: 0, y: 0 };
        var z = zoom > 0 ? zoom : 1;
        var a = screenToContent(c, p, z, r.left, r.top);
        var b = screenToContent(c, p, z, r.right, r.bottom);
        return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    }

    function contentCenterFromEl(canvasEl, el, pan, zoom) {
        if (!el || typeof el.getBoundingClientRect !== 'function') return null;
        var r = el.getBoundingClientRect();
        var c = canvasEl.getBoundingClientRect();
        return screenToContent(c, pan, zoom, r.left + r.width / 2, r.top + r.height / 2);
    }

    function makeUid() {
        return 'ec' + ((global.Date && Date.now()) || 0) + '_' + Math.floor(Math.random() * 1e6);
    }

    function hrefToDataUrl(href) {
        if (!href || typeof href !== 'string') return Promise.resolve('');
        if (href.indexOf('data:') === 0) return Promise.resolve(href);
        var full = href;
        if (typeof global.getAttachmentFullUrl === 'function') {
            try {
                full = global.getAttachmentFullUrl(href);
            } catch (_e) {}
        }
        var token = null;
        try {
            token = global.localStorage && global.localStorage.getItem('token');
        } catch (_e) {}
        var headers = {};
        if (token && full.indexOf('/api/') !== -1) headers.Authorization = 'Bearer ' + token;
        return fetch(full, { headers: headers, credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) return '';
                return res.blob();
            })
            .then(function (blob) {
                if (!blob) return '';
                return new Promise(function (resolve) {
                    var r = new FileReader();
                    r.onload = function () {
                        resolve(typeof r.result === 'string' ? r.result : '');
                    };
                    r.onerror = function () {
                        resolve('');
                    };
                    r.readAsDataURL(blob);
                });
            })
            .catch(function () {
                return '';
            });
    }

    /**
     * Centro lógico: se o nó central estiver display:none (modo padrão pontilhado), usa dados JSON.
     */
    function getCenterContentBounds(canvas, centerEl, pan, zoom, data) {
        var b = elementContentBounds(canvas, centerEl, pan, zoom);
        if (b && b.width > 2 && b.height > 2) return b;
        var cn = data && data.nodes && data.nodes.find(function (n) {
            return n && n.id === 'center';
        });
        var x = cn && typeof cn.x === 'number' ? cn.x : 150;
        var y = cn && typeof cn.y === 'number' ? cn.y : 80;
        return { x: x, y: y, width: 140, height: 56 };
    }

    /**
     * Pattern, sombra e marcador de seta (unidades = espaço de conteúdo do diagrama).
     */
    function buildDefs(uid) {
        return (
            '<defs>' +
            '<pattern id="' +
            uid +
            'Dot" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="translate(-5,-5)">' +
            '<circle cx="15" cy="15" r="2" fill="rgba(255,255,255,0.171)"/>' +
            '</pattern>' +
            '<filter id="' +
            uid +
            'Sh" x="-50%" y="-50%" width="200%" height="200%">' +
            '<feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.35"/>' +
            '</filter>' +
            '<marker id="' +
            uid +
            'Ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto" markerUnits="userSpaceOnUse">' +
            '<path d="M 0 0 L 10 5 L 0 10 Z" fill="rgba(255,255,255,0.78)"/>' +
            '</marker>' +
            '</defs>'
        );
    }

    /**
     * Exporta o viewport visível do canvas = "fotografia" do que se vê (pan + zoom).
     * viewBox alinhado ao pan; vw/vh com a MESMA proporção que width/height para evitar letterboxing.
     * Texto e traços nas mesmas unidades de conteúdo que o DOM (getBoundingClientRect / z).
     */
    async function buildSvgFromLiveDom(opts) {
        var canvas = opts.canvas;
        var centerEl = opts.centerEl;
        var branchesEl = opts.branchesEl;
        var data = opts.data || { nodes: [], edges: [] };
        var pan = opts.pan || { x: 0, y: 0 };
        var zoom = typeof opts.zoom === 'number' && opts.zoom > 0 ? opts.zoom : 1;
        var z = zoom;
        /** Escala de píxeis de saída (alta resolução): viewBox igual, width/height maiores. */
        var pixelScale = typeof opts.pixelScale === 'number' && opts.pixelScale > 0 ? opts.pixelScale : 1;

        var canvasRect = canvas.getBoundingClientRect();
        var cw = typeof canvas.clientWidth === 'number' && canvas.clientWidth > 0 ? canvas.clientWidth : canvasRect.width;
        var ch = typeof canvas.clientHeight === 'number' && canvas.clientHeight > 0 ? canvas.clientHeight : canvasRect.height;
        var outW = Math.max(1, Math.round(cw));
        var outH = Math.max(1, Math.round(ch));

        var vx = -pan.x / z;
        var vy = -pan.y / z;
        var vw = outW / z;
        /** Garante proporção idêntica a outW:outH (evita meet a encolher e centrar). */
        var vh = (vw * outH) / outW;
        var viewBoxStr = vx + ' ' + vy + ' ' + vw + ' ' + vh;

        var outWpx = Math.max(1, Math.round(outW * pixelScale));
        /** Mantém proporção exata com outW:outH (evita meet/none a distorcer 1px). */
        var outHpx = Math.max(1, Math.round((outWpx * outH) / outW));

        var uid = makeUid();
        var branchEls = branchesEl ? branchesEl.querySelectorAll('.annotation-mental-branch') : [];
        var branchById = {};
        branchEls.forEach(function (div) {
            if (div.dataset && div.dataset.id) branchById[div.dataset.id] = div;
        });

        var centerBounds = getCenterContentBounds(canvas, centerEl, pan, zoom, data);

        function edgeCenter(nodeId) {
            if (nodeId === 'center') {
                return {
                    x: centerBounds.x + centerBounds.width / 2,
                    y: centerBounds.y + centerBounds.height / 2
                };
            }
            var el = branchById[nodeId];
            if (!el) return null;
            return contentCenterFromEl(canvas, el, pan, zoom);
        }

        var edgePaths = '';
        (data.edges || []).forEach(function (edge) {
            var fromC = edgeCenter(edge.from);
            var toC = edgeCenter(edge.to);
            if (!fromC || !toC) return;
            var midX = (fromC.x + toC.x) / 2;
            var midY = (fromC.y + toC.y) / 2;
            var cpx = edge.controlPoint && typeof edge.controlPoint.x === 'number' ? edge.controlPoint.x : midX;
            var cpy = edge.controlPoint && typeof edge.controlPoint.y === 'number' ? edge.controlPoint.y : midY;
            var d = 'M ' + fromC.x + ' ' + fromC.y + ' Q ' + cpx + ' ' + cpy + ' ' + toC.x + ' ' + toC.y;
            edgePaths +=
                '<path d="' +
                escapeXmlAttr(d) +
                '" fill="none" stroke="rgba(255,255,255,0.72)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#' +
                uid +
                'Ar)"/>';
        });

        var strokeCard = 1;
        var rxCorner = 8;
        var nodesXml = '';

        /** Centro (visível ou só dados) */
        if (centerBounds && centerBounds.width > 0 && centerBounds.height > 0) {
            var cx = centerBounds.x;
            var cy = centerBounds.y;
            var cw = centerBounds.width;
            var ch = centerBounds.height;
            var label = (centerEl.textContent || '').trim() || 'Tarefa';
            var fsPx = 14;
            try {
                var cfs = global.getComputedStyle(centerEl);
                if (cfs && cfs.fontSize) fsPx = parseFloat(cfs.fontSize) || 14;
            } catch (_e) {}
            var fs = fsPx;
            nodesXml +=
                '<g data-node="center">' +
                '<rect x="' +
                cx +
                '" y="' +
                cy +
                '" width="' +
                cw +
                '" height="' +
                ch +
                '" rx="' +
                rxCorner +
                '" fill="#0d0d0d" stroke="rgba(255,255,255,0.15)" stroke-width="' +
                strokeCard +
                '" filter="url(#' +
                uid +
                'Sh)"/>' +
                '<text x="' +
                (cx + 10) +
                '" y="' +
                (cy + Math.min(fs * 1.15, ch * 0.45)) +
                '" fill="#f8fafc" font-family="' +
                FONT_STACK +
                '" font-size="' +
                fs +
                '" dominant-baseline="hanging">' +
                escapeXml(label) +
                '</text>' +
                '</g>';
        }

        for (var bi = 0; bi < branchEls.length; bi++) {
            var div = branchEls[bi];
            var rect = elementContentBounds(canvas, div, pan, zoom);
            if (!rect || rect.width <= 0 || rect.height <= 0) continue;

            var bg = '#0d0d0d';
            var fontCol = '#f8fafc';
            try {
                var cs = global.getComputedStyle(div);
                if (cs && cs.backgroundColor && cs.backgroundColor !== 'transparent') bg = cs.backgroundColor;
                if (cs && cs.color) fontCol = cs.color;
            } catch (_e) {}

            var rx =
                div.classList && div.classList.contains('annotation-mental-branch--balloon')
                    ? Math.min(rect.width / 2, 36)
                    : rxCorner;

            nodesXml +=
                '<g data-node="' +
                escapeXmlAttr(div.dataset.id || '') +
                '">' +
                '<rect x="' +
                rect.x +
                '" y="' +
                rect.y +
                '" width="' +
                rect.width +
                '" height="' +
                rect.height +
                '" rx="' +
                rx +
                '" fill="' +
                escapeXmlAttr(bg) +
                '" stroke="rgba(255,255,255,0.15)" stroke-width="' +
                strokeCard +
                '" filter="url(#' +
                uid +
                'Sh)"/>';

            var labelEl = div.querySelector('.annotation-mental-branch-label');
            if (labelEl) {
                var lr = elementContentBounds(canvas, labelEl, pan, zoom);
                if (lr && lr.height > 0) {
                    var fsLPx = 13;
                    try {
                        var csL = global.getComputedStyle(labelEl);
                        if (csL && csL.fontSize) fsLPx = parseFloat(csL.fontSize) || 13;
                    } catch (_e2) {}
                    var fsL = fsLPx;
                    var lines = (labelEl.innerText || labelEl.textContent || '')
                        .split(/\r?\n/)
                        .map(function (l) {
                            return l.trim();
                        })
                        .filter(Boolean);
                    if (lines.length === 0) lines = [''];
                    var lineGap = Math.max(fsL * 1.2, 12);
                    for (var li = 0; li < lines.length; li++) {
                        nodesXml +=
                            '<text x="' +
                            lr.x +
                            '" y="' +
                            (lr.y + li * lineGap) +
                            '" fill="' +
                            escapeXmlAttr(fontCol) +
                            '" font-family="' +
                            FONT_STACK +
                            '" font-size="' +
                            fsL +
                            '" dominant-baseline="hanging">' +
                            escapeXml(lines[li]) +
                            '</text>';
                    }
                }
            }

            var descEl = div.querySelector('.annotation-mental-branch-description-editor');
            if (descEl && div.classList.contains('has-description')) {
                var dr = elementContentBounds(canvas, descEl, pan, zoom);
                if (dr && dr.height > 0) {
                    var fsDPx = 11;
                    try {
                        var csD = global.getComputedStyle(descEl);
                        if (csD && csD.fontSize) fsDPx = parseFloat(csD.fontSize) || 11;
                    } catch (_e3) {}
                    var fsD = fsDPx;
                    var dlines = (descEl.innerText || '').split(/\r?\n/).slice(0, 12);
                    var dg = Math.max(fsD * 1.25, 11);
                    for (var di = 0; di < dlines.length; di++) {
                        nodesXml +=
                            '<text x="' +
                            dr.x +
                            '" y="' +
                            (dr.y + di * dg) +
                            '" fill="rgba(248,250,252,0.85)" font-family="' +
                            FONT_STACK +
                            '" font-size="' +
                            fsD +
                            '" dominant-baseline="hanging">' +
                            escapeXml(dlines[di].trim()) +
                            '</text>';
                    }
                }
            }

            var img = div.querySelector('.annotation-mental-branch-image-img');
            if (img && img.src) {
                var dataUrl = await hrefToDataUrl(img.src);
                if (dataUrl) {
                    var ir = elementContentBounds(canvas, img, pan, zoom);
                    if (ir && ir.width > 0 && ir.height > 0) {
                        nodesXml +=
                            '<image href="' +
                            escapeXmlAttr(dataUrl) +
                            '" xlink:href="' +
                            escapeXmlAttr(dataUrl) +
                            '" x="' +
                            ir.x +
                            '" y="' +
                            ir.y +
                            '" width="' +
                            ir.width +
                            '" height="' +
                            ir.height +
                            '" preserveAspectRatio="xMidYMid meet"/>';
                    }
                }
            }

            nodesXml += '</g>';
        }

        var svg =
            '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<svg xmlns="' +
            NS +
            '" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
            'width="' +
            outWpx +
            '" height="' +
            outHpx +
            '" viewBox="' +
            viewBoxStr +
            '" preserveAspectRatio="none" overflow="hidden" ' +
            'role="img" aria-label="Diagrama mental">\n' +
            buildDefs(uid) +
            '<rect x="' +
            vx +
            '" y="' +
            vy +
            '" width="' +
            vw +
            '" height="' +
            vh +
            '" fill="#313131"/>' +
            '<rect x="' +
            vx +
            '" y="' +
            vy +
            '" width="' +
            vw +
            '" height="' +
            vh +
            '" fill="url(#' +
            uid +
            'Dot)"/>' +
            '<g id="edges">' +
            edgePaths +
            '</g>' +
            '<g id="nodes">' +
            nodesXml +
            '</g>\n' +
            '</svg>';

        return svg;
    }

    /**
     * Export a partir de JSON (sem DOM) — documento completo do mapa, offline.
     */
    async function buildSvgFromJsonData(parsed) {
        if (!parsed || !parsed.nodes || !Array.isArray(parsed.nodes)) {
            return Promise.reject(new Error('Dados de diagrama inválidos.'));
        }
        var nodes = parsed.nodes;
        var edges = parsed.edges || [];
        var cnode = nodes.find(function (n) {
            return n && n.id === 'center';
        });
        var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        function growNode(n) {
            if (!n || n.id === 'center') return;
            var x = typeof n.x === 'number' ? n.x : 0;
            var y = typeof n.y === 'number' ? n.y : 0;
            var w = typeof n.width === 'number' ? n.width : 140;
            var h = typeof n.height === 'number' ? n.height : 140;
            b.minX = Math.min(b.minX, x);
            b.minY = Math.min(b.minY, y);
            b.maxX = Math.max(b.maxX, x + w);
            b.maxY = Math.max(b.maxY, y + h);
        }
        nodes.forEach(growNode);
        if (cnode) {
            var _cx = typeof cnode.x === 'number' ? cnode.x : 150;
            var _cy = typeof cnode.y === 'number' ? cnode.y : 80;
            b.minX = Math.min(b.minX, _cx);
            b.minY = Math.min(b.minY, _cy);
            b.maxX = Math.max(b.maxX, _cx + 140);
            b.maxY = Math.max(b.maxY, _cy + 56);
        }
        edges.forEach(function (e) {
            var fe = nodes.find(function (n) {
                return n.id === e.from;
            });
            var te = nodes.find(function (n) {
                return n.id === e.to;
            });
            if (!fe || !te) return;
            function centerOf(n) {
                if (n.id === 'center') {
                    var fx = typeof n.x === 'number' ? n.x : 150;
                    var fy = typeof n.y === 'number' ? n.y : 80;
                    return { x: fx + 70, y: fy + 28 };
                }
                var nx = typeof n.x === 'number' ? n.x : 0;
                var ny = typeof n.y === 'number' ? n.y : 0;
                var nw = typeof n.width === 'number' ? n.width : 140;
                var nh = typeof n.height === 'number' ? n.height : 140;
                return { x: nx + nw / 2, y: ny + nh / 2 };
            }
            var p1 = centerOf(fe);
            var p2 = centerOf(te);
            var midX = (p1.x + p2.x) / 2;
            var midY = (p1.y + p2.y) / 2;
            var cpx = e.controlPoint && typeof e.controlPoint.x === 'number' ? e.controlPoint.x : midX;
            var cpy = e.controlPoint && typeof e.controlPoint.y === 'number' ? e.controlPoint.y : midY;
            b.minX = Math.min(b.minX, p1.x, p2.x, cpx);
            b.minY = Math.min(b.minY, p1.y, p2.y, cpy);
            b.maxX = Math.max(b.maxX, p1.x, p2.x, cpx);
            b.maxY = Math.max(b.maxY, p1.y, p2.y, cpy);
        });

        var pad = 32;
        if (!isFinite(b.minX)) {
            b.minX = 0;
            b.minY = 0;
            b.maxX = 800;
            b.maxY = 600;
        }
        b.minX -= pad;
        b.minY -= pad;
        b.maxX += pad;
        b.maxY += pad;
        var vbW = Math.max(1, b.maxX - b.minX);
        var vbH = Math.max(1, b.maxY - b.minY);
        var viewBoxStr = b.minX + ' ' + b.minY + ' ' + vbW + ' ' + vbH;
        var uid = makeUid();

        var edgePaths = '';
        edges.forEach(function (edge) {
            var fe = nodes.find(function (n) {
                return n.id === edge.from;
            });
            var te = nodes.find(function (n) {
                return n.id === edge.to;
            });
            if (!fe || !te) return;
            function centerOf(n) {
                if (n.id === 'center') {
                    var fx = typeof n.x === 'number' ? n.x : 150;
                    var fy = typeof n.y === 'number' ? n.y : 80;
                    return { x: fx + 70, y: fy + 28 };
                }
                var nx = typeof n.x === 'number' ? n.x : 0;
                var ny = typeof n.y === 'number' ? n.y : 0;
                var nw = typeof n.width === 'number' ? n.width : 140;
                var nh = typeof n.height === 'number' ? n.height : 140;
                return { x: nx + nw / 2, y: ny + nh / 2 };
            }
            var p1 = centerOf(fe);
            var p2 = centerOf(te);
            var midX = (p1.x + p2.x) / 2;
            var midY = (p1.y + p2.y) / 2;
            var cpx = edge.controlPoint && typeof edge.controlPoint.x === 'number' ? edge.controlPoint.x : midX;
            var cpy = edge.controlPoint && typeof edge.controlPoint.y === 'number' ? edge.controlPoint.y : midY;
            var d = 'M ' + p1.x + ' ' + p1.y + ' Q ' + cpx + ' ' + cpy + ' ' + p2.x + ' ' + p2.y;
            edgePaths +=
                '<path d="' +
                escapeXmlAttr(d) +
                '" fill="none" stroke="rgba(255,255,255,0.72)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#' +
                uid +
                'Ar)"/>';
        });

        var nodesXml = '';
        if (cnode) {
            var ccx = typeof cnode.x === 'number' ? cnode.x : 150;
            var ccy = typeof cnode.y === 'number' ? cnode.y : 80;
            var clabel = (cnode.label && String(cnode.label).trim()) || 'Tarefa';
            nodesXml +=
                '<g data-node="center">' +
                '<rect x="' +
                ccx +
                '" y="' +
                ccy +
                '" width="140" height="56" rx="8" fill="#0d0d0d" stroke="rgba(255,255,255,0.15)" stroke-width="1" filter="url(#' +
                uid +
                'Sh)"/>' +
                '<text x="' +
                (ccx + 10) +
                '" y="' +
                (ccy + 18) +
                '" fill="#f8fafc" font-family="' +
                FONT_STACK +
                '" font-size="14" dominant-baseline="hanging">' +
                escapeXml(clabel) +
                '</text>' +
                '</g>';
        }

        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (!n || n.id === 'center') continue;
            var x = typeof n.x === 'number' ? n.x : 0;
            var y = typeof n.y === 'number' ? n.y : 0;
            var w = typeof n.width === 'number' ? n.width : 140;
            var h = typeof n.height === 'number' ? n.height : 140;
            var bg = typeof n.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(n.color) ? n.color : '#0d0d0d';
            var fc = typeof n.fontColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(n.fontColor) ? n.fontColor : '#f8fafc';
            var label = (n.label && String(n.label).trim()) || '';
            var rx = n.shape === 'balloon' ? Math.min(w / 2, 36) : 8;
            nodesXml +=
                '<g data-node="' +
                escapeXmlAttr(n.id) +
                '">' +
                '<rect x="' +
                x +
                '" y="' +
                y +
                '" width="' +
                w +
                '" height="' +
                h +
                '" rx="' +
                rx +
                '" fill="' +
                escapeXmlAttr(bg) +
                '" stroke="rgba(255,255,255,0.15)" stroke-width="1" filter="url(#' +
                uid +
                'Sh)"/>' +
                '<text x="' +
                (x + 8) +
                '" y="' +
                (y + 10) +
                '" fill="' +
                escapeXmlAttr(fc) +
                '" font-family="' +
                FONT_STACK +
                '" font-size="13" dominant-baseline="hanging">' +
                escapeXml(label) +
                '</text>';

            if (n.description && String(n.description).trim()) {
                var desc = String(n.description).trim().split(/\r?\n/).slice(0, 8);
                for (var di = 0; di < desc.length; di++) {
                    nodesXml +=
                        '<text x="' +
                        (x + 8) +
                        '" y="' +
                        (y + 32 + di * 14) +
                        '" fill="rgba(248,250,252,0.85)" font-family="' +
                        FONT_STACK +
                        '" font-size="11" dominant-baseline="hanging">' +
                        escapeXml(desc[di]) +
                        '</text>';
                }
            }

            var imgHref = '';
            if (n.imageData && typeof n.imageData === 'string' && n.imageData.indexOf('data:image') === 0) {
                imgHref = n.imageData;
            } else if (n.image && n.image.url) {
                imgHref = await hrefToDataUrl(n.image.url);
            }
            if (imgHref) {
                var ix = x + 8;
                var iy = y + (label ? 48 : 28);
                var iw = Math.max(20, w - 16);
                var ih = Math.max(20, h - (label ? 56 : 36));
                nodesXml +=
                    '<image href="' +
                    escapeXmlAttr(imgHref) +
                    '" xlink:href="' +
                    escapeXmlAttr(imgHref) +
                    '" x="' +
                    ix +
                    '" y="' +
                    iy +
                    '" width="' +
                    iw +
                    '" height="' +
                    ih +
                    '" preserveAspectRatio="xMidYMid meet"/>';
            }
            nodesXml += '</g>';
        }

        var outWpx = Math.round(Math.min(2400, Math.max(400, vbW)));
        var outHpx = Math.round(Math.min(2400, Math.max(300, vbH)));

        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<svg xmlns="' +
            NS +
            '" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
            'width="' +
            outWpx +
            '" height="' +
            outHpx +
            '" viewBox="' +
            viewBoxStr +
            '" preserveAspectRatio="xMidYMid meet" overflow="hidden" ' +
            'role="img" aria-label="Diagrama mental">\n' +
            buildDefs(uid) +
            '<rect x="' +
            b.minX +
            '" y="' +
            b.minY +
            '" width="' +
            vbW +
            '" height="' +
            vbH +
            '" fill="#313131"/>' +
            '<rect x="' +
            b.minX +
            '" y="' +
            b.minY +
            '" width="' +
            vbW +
            '" height="' +
            vbH +
            '" fill="url(#' +
            uid +
            'Dot)"/>' +
            '<g id="edges">' +
            edgePaths +
            '</g>' +
            '<g id="nodes">' +
            nodesXml +
            '</g>\n' +
            '</svg>'
        );
    }

    function defaultDownload(svgString, filename) {
        var blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename.indexOf('.svg') === -1 ? filename + '.svg' : filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 2500);
    }

    var api = {
        escapeXml: escapeXml,
        buildSvgFromLiveDom: buildSvgFromLiveDom,
        buildSvgFromJsonData: buildSvgFromJsonData,
        downloadSvg: function (svgString, filename, downloadFn) {
            var fn = downloadFn || (typeof global.triggerDownloadBlob === 'function' ? function (blob, name) {
                global.triggerDownloadBlob(blob, name);
            } : null);
            if (fn && fn.length >= 2) {
                fn(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }), filename.indexOf('.svg') === -1 ? filename + '.svg' : filename);
            } else {
                defaultDownload(svgString, filename);
            }
        },
        exportFromLiveEditor: async function (filenameBase) {
            var canvas = document.getElementById('annotationMentalCanvas');
            var centerEl = document.getElementById('annotationMentalCenter');
            var branchesEl = document.getElementById('annotationMentalBranches');
            var data = global._annotationMentalData;
            if (!canvas || !centerEl || !branchesEl || !data) {
                throw new Error('Editor de diagrama não disponível.');
            }
            var pan = global._annotationMentalPan || { x: 0, y: 0 };
            var zoom = typeof global._annotationMentalZoom === 'number' && global._annotationMentalZoom > 0 ? global._annotationMentalZoom : 1;
            var svg = await buildSvgFromLiveDom({
                canvas: canvas,
                centerEl: centerEl,
                branchesEl: branchesEl,
                data: data,
                pan: pan,
                zoom: zoom
            });
            var name = filenameBase || 'diagrama-mental';
            api.downloadSvg(svg, name);
            return svg;
        }
    };

    global.MentalDiagramSvgExport = api;
})(typeof window !== 'undefined' ? window : this);
