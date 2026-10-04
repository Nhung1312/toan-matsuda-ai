/**
 * TOÁN MATSUDA AI - SPRINT 4
 * Tích hợp FastAPI + Gemini Vision
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- BẢO VỆ MÔI TRƯỜNG PREVIEW IFRAME & INSPECTOR ---
    window.addEventListener('error', (event) => {
        if (event && event.message && (
            event.message.includes("Cannot create property 'element'") ||
            event.message.includes("requestAdapter") ||
            event.message.includes("powerPreference") ||
            event.message.includes("No available adapters")
        )) {
            console.warn('Ghi nhận và bỏ qua cảnh báo inspector môi trường AI Studio preview:', event.message);
            event.preventDefault();
        }
    });

    // --- HỆ THỐNG THÔNG BÁO TOAST THAY THẾ TOÀN BỘ WINDOW.ALERT ---
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) {
            console.log(`[${type}] ${message}`);
            return;
        }
        const toast = document.createElement('div');
        toast.className = `toast-msg toast-${type}`;
        const iconMap = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        toast.innerHTML = `
            <span class="toast-icon">${iconMap[type] || 'ℹ️'}</span>
            <span class="toast-text">${message}</span>
        `;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 3500);
    }

    // --- API BASE URL RESOLUTION & HEALTH CHECK ---
    function getApiBaseUrl() {
        if (window.API_BASE_URL && typeof window.API_BASE_URL === 'string') {
            return window.API_BASE_URL.replace(/\/+$/, '');
        }
        return '';
    }

    async function checkBackendHealth() {
        const healthUrl = `${getApiBaseUrl()}/api/health`;
        try {
            console.log(`[Health Check] Checking backend health at: ${healthUrl}`);
            const res = await fetch(healthUrl);
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                const data = await res.json();
                console.log('[Health Check] Backend is online and ready:', data);
            } else {
                const text = await res.text();
                console.warn('[Health Check] Non-JSON response received:', res.status, ct, text.slice(0, 100));
            }
        } catch (err) {
            console.warn('[Health Check] Failed to reach backend health endpoint:', err.message);
        }
    }
    checkBackendHealth();
    
    // --- DOM ELEMENTS ---
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const uploadDefault = document.getElementById('upload-default');
    const uploadPreview = document.getElementById('upload-preview');
    const pagesCountText = document.getElementById('pages-count-text');
    const btnAddMorePages = document.getElementById('btn-add-more-pages');
    const btnClearAllPages = document.getElementById('btn-clear-all-pages');
    const pagesListContainer = document.getElementById('pages-list-container');
    const btnGrade = document.getElementById('btn-grade');
    const btnResetMain = document.getElementById('btn-reset-main');
    const btnPasteClipboard = document.getElementById('btn-paste-clipboard');
    const btnSampleMath = document.getElementById('btn-sample-math');
    const fileInputMore = document.getElementById('file-input-more');
    const fileInputBtn = document.getElementById('file-input-btn');

    const sectionUpload = document.getElementById('upload-section');
    const sectionResult = document.getElementById('result-section');

    // Kết quả elements
    const animatedScore = document.getElementById('animated-score');
    const scoreMarker = document.getElementById('score-marker');
    const resultSummary = document.getElementById('result-summary');
    const questionsList = document.getElementById('questions-list');
    const overallFeedbackList = document.getElementById('overall-feedback-list');

    // Multi-page & History State
    let uploadedPages = []; // [{ id, file, name, size, width, height, rotation, originalDataUrl, displayDataUrl, optimizedBlob }]
    let currentGradingImages = []; // [{ pageIndex, dataUrl, originalDataUrl, name }]
    let activeStudentPageByQuestion = {};
    let selectedFileUrl = null;

    // --- INDEXEDDB HELPER FOR GRADING HISTORY ---
    const MatsudaDB = {
        db: null,
        async init() {
            if (this.db) return this.db;
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('ToanMatsudaAI_DB', 1);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('grading_history')) {
                        const store = db.createObjectStore('grading_history', { keyPath: 'id' });
                        store.createIndex('createdAt', 'createdAt', { unique: false });
                    }
                };
                request.onsuccess = (e) => {
                    this.db = e.target.result;
                    resolve(this.db);
                };
                request.onerror = (e) => reject(e);
            });
        },
        async saveHistory(item) {
            await this.init();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('grading_history', 'readwrite');
                const store = tx.objectStore('grading_history');
                store.put(item);
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e);
            });
        },
        async getAllHistory() {
            await this.init();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('grading_history', 'readonly');
                const store = tx.objectStore('grading_history');
                const req = store.getAll();
                req.onsuccess = () => {
                    const items = req.result || [];
                    items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                    resolve(items);
                };
                req.onerror = (e) => reject(e);
            });
        },
        async deleteHistory(id) {
            await this.init();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('grading_history', 'readwrite');
                const store = tx.objectStore('grading_history');
                store.delete(id);
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e);
            });
        },
        async clearAllHistory() {
            await this.init();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction('grading_history', 'readwrite');
                const store = tx.objectStore('grading_history');
                store.clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e);
            });
        }
    };

    // Update history badge count
    async function updateHistoryBadge() {
        try {
            const items = await MatsudaDB.getAllHistory();
            const badge = document.getElementById('history-badge-count');
            if (badge) badge.innerText = String(items.length);
            const total = document.getElementById('history-total-count');
            if (total) total.innerText = `${items.length} bài`;
        } catch (_) {}
    }
    updateHistoryBadge();

    // Helper: format bytes
    function formatBytes(bytes) {
        if (!+bytes) return '0 Bytes';
        const k = 1024, i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${['Bytes', 'KB', 'MB', 'GB'][i]}`;
    }

    // Helper: generate rotated / scaled canvas
    function getRotatedCanvas(img, rotation, maxDim = null) {
        const sw = img.naturalWidth || img.width;
        const sh = img.naturalHeight || img.height;
        
        let targetW = sw;
        let targetH = sh;
        if (maxDim && (sw > maxDim || sh > maxDim)) {
            if (sw >= sh) {
                targetW = maxDim;
                targetH = Math.round((sh * maxDim) / sw);
            } else {
                targetH = maxDim;
                targetW = Math.round((sw * maxDim) / sh);
            }
        }

        const rot = ((rotation % 360) + 360) % 360;
        const canvas = document.createElement('canvas');
        if (rot === 90 || rot === 270) {
            canvas.width = targetH;
            canvas.height = targetW;
        } else {
            canvas.width = targetW;
            canvas.height = targetH;
        }

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.save();
        if (rot === 90) {
            ctx.translate(canvas.width, 0);
            ctx.rotate(Math.PI / 2);
        } else if (rot === 180) {
            ctx.translate(canvas.width, canvas.height);
            ctx.rotate(Math.PI);
        } else if (rot === 270) {
            ctx.translate(0, canvas.height);
            ctx.rotate(3 * Math.PI / 2);
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        ctx.restore();

        return canvas;
    }

    // --- MỤC 1: BỘ LỌC QUÉT TÀI LIỆU & LÀM RÕ CHỮ VIẾT TAY (THCS DOCUMENT SCANNER) ---
    function applyDocumentFilter(canvas, filterMode = 'original') {
        if (!canvas || !filterMode || filterMode === 'original') return canvas;
        try {
            const ctx = canvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imgData.data;
            const len = d.length;

            if (filterMode === 'scanner') {
                // Quét tài liệu: Khử bóng đèn bàn học, làm trắng nền giấy ô li, làm nổi bật nét bút chì, phân số & số mũ
                for (let i = 0; i < len; i += 4) {
                    const r = d[i], g = d[i + 1], b = d[i + 2];
                    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                    if (lum > 175) {
                        // Nền giấy -> nâng sáng trắng sạch
                        d[i] = Math.min(255, Math.round(r * 1.25 + 20));
                        d[i + 1] = Math.min(255, Math.round(g * 1.25 + 20));
                        d[i + 2] = Math.min(255, Math.round(b * 1.25 + 20));
                    } else if (lum < 130) {
                        // Nét chữ viết tay, mực bút chì -> làm đậm nét và sắc
                        d[i] = Math.max(0, Math.round(r * 0.72));
                        d[i + 1] = Math.max(0, Math.round(g * 0.72));
                        d[i + 2] = Math.max(0, Math.round(b * 0.72));
                    } else {
                        // Vùng trung gian -> tăng tương phản mượt
                        d[i] = Math.min(255, Math.max(0, Math.round((r - 128) * 1.25 + 128)));
                        d[i + 1] = Math.min(255, Math.max(0, Math.round((g - 128) * 1.25 + 128)));
                        d[i + 2] = Math.min(255, Math.max(0, Math.round((b - 128) * 1.25 + 128)));
                    }
                }
                ctx.putImageData(imgData, 0, 0);
            } else if (filterMode === 'contrast') {
                // Tương phản cao: Làm nổi rõ số mũ nhỏ, căn thức, dấu trừ (-)
                const contrast = 1.45;
                const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
                for (let i = 0; i < len; i += 4) {
                    d[i] = Math.min(255, Math.max(0, Math.round(factor * (d[i] - 128) + 128)));
                    d[i + 1] = Math.min(255, Math.max(0, Math.round(factor * (d[i + 1] - 128) + 128)));
                    d[i + 2] = Math.min(255, Math.max(0, Math.round(factor * (d[i + 2] - 128) + 128)));
                }
                ctx.putImageData(imgData, 0, 0);
            } else if (filterMode === 'bw') {
                // Chuẩn Photocopy tài liệu: Đen trắng rõ nét
                for (let i = 0; i < len; i += 4) {
                    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    const val = lum > 148 ? 255 : (lum < 95 ? 0 : Math.round(((lum - 95) / (148 - 95)) * 255));
                    d[i] = val;
                    d[i + 1] = val;
                    d[i + 2] = val;
                }
                ctx.putImageData(imgData, 0, 0);
            }
        } catch (err) {
            console.warn('Document filter processing warning:', err);
        }
        return canvas;
    }

    // Optimize image for Gemini AI with adaptive quality (0.80 - 0.86) and max dimension (1400 - 1600)
    async function optimizeImageForAI(page) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const maxDim = 1600; // Bảo đảm chi tiết sắc nét cho chữ viết tay, số mũ, phân số mà dung lượng nhẹ tải cực nhanh
                let canvas = getRotatedCanvas(img, page.rotation, maxDim);
                
                // Áp dụng bộ lọc tài liệu đã chọn nếu có
                if (page.filterMode && page.filterMode !== 'original') {
                    canvas = applyDocumentFilter(canvas, page.filterMode);
                }

                // Adaptive quality based on image complexity
                let quality = 0.82;
                if (canvas.width * canvas.height < 1000 * 1000) quality = 0.86;
                else if (canvas.width * canvas.height > 1600 * 1600) quality = 0.78;

                // Update displayDataUrl to match rotated/filtered canvas coordinate space
                page.displayDataUrl = canvas.toDataURL('image/jpeg', 0.85);

                canvas.toBlob((blob) => {
                    page.optimizedBlob = blob || page.file;
                    resolve(page.optimizedBlob);
                }, 'image/jpeg', quality);
            };
            img.onerror = () => {
                console.warn('Lỗi xử lý tối ưu canvas, dùng ảnh ban đầu:', page.name);
                page.optimizedBlob = page.file;
                resolve(page.file);
            };
            img.src = page.originalDataUrl;
        });
    }

    // Update thumbnail of page card when rotated or filtered
    function updatePageDisplay(page) {
        const img = new Image();
        img.onload = () => {
            let canvas = getRotatedCanvas(img, page.rotation, 800);
            if (page.filterMode && page.filterMode !== 'original') {
                canvas = applyDocumentFilter(canvas, page.filterMode);
            }
            page.displayDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            renderUploadedPagesList();
        };
        img.onerror = () => {
            renderUploadedPagesList();
        };
        img.src = page.originalDataUrl;
    }

    // Helper: Verify if file is a supported image
    function isImageFile(file) {
        if (!file) return false;
        if (file.type && file.type.startsWith('image/')) return true;
        const name = (file.name || '').toLowerCase();
        if (/\.(jpe?g|png|webp|gif|bmp|heic|heif|jfif|tiff?|svg)$/i.test(name)) return true;
        // Cho phép các tệp nhị phân kéo thả nếu trình duyệt chưa gán mimetype
        if (!file.type || file.type.includes('octet-stream')) return true;
        return false;
    }

    // Process files dropped or selected
    async function handleFiles(fileList) {
        if (!fileList || fileList.length === 0) return;

        const validFiles = Array.from(fileList).filter(isImageFile);
        if (validFiles.length === 0) {
            showToast('Vui lòng chọn tệp hình ảnh hợp lệ (PNG, JPG, WEBP, JPEG, HEIC).', 'warning');
            return;
        }

        let loadedCount = 0;
        for (const file of validFiles) {
            await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const dataUrl = e.target.result;
                    const img = new Image();
                    img.onload = () => {
                        uploadedPages.push({
                            id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                            file: file,
                            name: file.name || `trang_${uploadedPages.length + 1}.jpg`,
                            size: file.size || 0,
                            width: img.naturalWidth || 1000,
                            height: img.naturalHeight || 800,
                            rotation: 0,
                            originalDataUrl: dataUrl,
                            displayDataUrl: dataUrl,
                            optimizedBlob: null
                        });
                        loadedCount++;
                        resolve();
                    };
                    img.onerror = () => {
                        console.warn('Lỗi hiển thị ảnh, vẫn giữ tệp ảnh gốc:', file.name);
                        uploadedPages.push({
                            id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                            file: file,
                            name: file.name || `trang_${uploadedPages.length + 1}.jpg`,
                            size: file.size || 0,
                            width: 1000,
                            height: 800,
                            rotation: 0,
                            originalDataUrl: dataUrl,
                            displayDataUrl: dataUrl,
                            optimizedBlob: null
                        });
                        loadedCount++;
                        resolve();
                    };
                    img.src = dataUrl;
                };
                reader.onerror = () => {
                    console.warn('FileReader error:', file.name);
                    resolve();
                };
                reader.readAsDataURL(file);
            });
        }

        if (uploadedPages.length > 0) {
            selectedFileUrl = uploadedPages[0].displayDataUrl;
            showToast(`Đã nhận ${loadedCount} trang ảnh bài làm.`, 'success');
        }

        renderUploadedPagesList();
    }

    // Render list of page cards in upload-preview
    function renderUploadedPagesList() {
        if (uploadedPages.length === 0) {
            resetUploadArea();
            return;
        }

        uploadDefault.classList.add('hidden');
        uploadPreview.classList.remove('hidden');
        if (fileInput) fileInput.style.display = 'none';
        dropZone.style.borderStyle = 'solid';
        dropZone.style.borderColor = 'var(--color-primary)';

        if (pagesCountText) {
            pagesCountText.innerText = `${uploadedPages.length} trang bài làm`;
        }

        pagesListContainer.innerHTML = '';
        uploadedPages.forEach((page, idx) => {
            const card = document.createElement('div');
            card.className = 'page-card-item slide-up';
            card.innerHTML = `
                <div class="page-card-header">
                    <span class="page-badge-num">Trang ${idx + 1}</span>
                    <div class="page-reorder-btns">
                        <button type="button" class="btn-icon-tiny btn-move-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="Chuyển lên trước">▲ Lên</button>
                        <button type="button" class="btn-icon-tiny btn-move-down" data-idx="${idx}" ${idx === uploadedPages.length - 1 ? 'disabled' : ''} title="Chuyển xuống sau">▼ Xuống</button>
                    </div>
                </div>
                <div class="page-thumb-box" data-idx="${idx}" title="Nhấn để phóng to trang ${idx + 1}">
                    <img class="page-thumb-img" src="${page.displayDataUrl}" alt="Trang ${idx + 1}">
                    <span class="thumb-zoom-hint">🔍 Xem</span>
                </div>
                <div class="page-card-info">
                    <span>${page.width} × ${page.height} • ${formatBytes(page.size)}</span>
                    <span class="page-rotate-val">${page.rotation}°</span>
                    ${page.isCropped ? '<span class="page-cropped-badge" title="Đã khoanh vùng cắt bài làm">✂️ Đã cắt</span>' : ''}
                </div>
                <div class="page-filter-group">
                    <span class="page-filter-label">Quét nét:</span>
                    <button type="button" class="btn-page-filter ${(page.filterMode === 'original' || !page.filterMode) ? 'active' : ''}" data-idx="${idx}" data-filter="original" title="Giữ nguyên ảnh gốc">Gốc</button>
                    <button type="button" class="btn-page-filter ${page.filterMode === 'scanner' ? 'active' : ''}" data-idx="${idx}" data-filter="scanner" title="Quét tài liệu: Làm trắng nền giấy, khử bóng mờ & làm rõ nét chữ">⚡ Scan</button>
                    <button type="button" class="btn-page-filter ${page.filterMode === 'contrast' ? 'active' : ''}" data-idx="${idx}" data-filter="contrast" title="Tăng tương phản: Làm đậm nét số mũ nhỏ và dấu âm">🔆 Nét</button>
                    <button type="button" class="btn-page-filter ${page.filterMode === 'bw' ? 'active' : ''}" data-idx="${idx}" data-filter="bw" title="Trắng đen chuẩn Photocopy">⬛ Đ/T</button>
                </div>
                <div class="page-card-actions">
                    <button type="button" class="btn-crop-page" data-idx="${idx}" title="Cắt & Khoanh vùng câu cần chấm (tránh bị chấm lẫn câu khác)">✂️ Khoanh vùng</button>
                    <div class="page-rotate-group">
                        <button type="button" class="btn-rotate btn-rotate-left" data-idx="${idx}" title="Xoay trái 90°">↶ 90°</button>
                        <button type="button" class="btn-rotate btn-rotate-right" data-idx="${idx}" title="Xoay phải 90°">↷ 90°</button>
                        <button type="button" class="btn-rotate btn-rotate-reset" data-idx="${idx}" title="Khôi phục góc xoay">↻ 0°</button>
                    </div>
                    <button type="button" class="btn-delete-page" data-idx="${idx}" title="Xóa trang này">🗑 Xóa</button>
                </div>
            `;
            pagesListContainer.appendChild(card);
        });

        // Reorder Up
        pagesListContainer.querySelectorAll('.btn-move-up').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-idx'));
                if (idx > 0) {
                    const temp = uploadedPages[idx];
                    uploadedPages[idx] = uploadedPages[idx - 1];
                    uploadedPages[idx - 1] = temp;
                    renderUploadedPagesList();
                }
            });
        });

        // Reorder Down
        pagesListContainer.querySelectorAll('.btn-move-down').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-idx'));
                if (idx < uploadedPages.length - 1) {
                    const temp = uploadedPages[idx];
                    uploadedPages[idx] = uploadedPages[idx + 1];
                    uploadedPages[idx + 1] = temp;
                    renderUploadedPagesList();
                }
            });
        });

        // Rotate Left
        pagesListContainer.querySelectorAll('.btn-rotate-left').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-idx'));
                uploadedPages[idx].rotation = ((uploadedPages[idx].rotation - 90) % 360 + 360) % 360;
                uploadedPages[idx].optimizedBlob = null;
                updatePageDisplay(uploadedPages[idx]);
            });
        });

        // Rotate Right
        pagesListContainer.querySelectorAll('.btn-rotate-right').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-idx'));
                uploadedPages[idx].rotation = (uploadedPages[idx].rotation + 90) % 360;
                uploadedPages[idx].optimizedBlob = null;
                updatePageDisplay(uploadedPages[idx]);
            });
        });

        // Rotate Reset
        pagesListContainer.querySelectorAll('.btn-rotate-reset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-idx'));
                uploadedPages[idx].rotation = 0;
                uploadedPages[idx].optimizedBlob = null;
                updatePageDisplay(uploadedPages[idx]);
            });
        });

        // Delete Page
        pagesListContainer.querySelectorAll('.btn-delete-page').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-idx'));
                uploadedPages.splice(idx, 1);
                renderUploadedPagesList();
            });
        });

        // Page Filter Presets (Gốc, Scan, Nét, Đ/T)
        pagesListContainer.querySelectorAll('.btn-page-filter').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-idx'));
                const filter = btn.getAttribute('data-filter');
                if (uploadedPages[idx]) {
                    uploadedPages[idx].filterMode = filter;
                    uploadedPages[idx].optimizedBlob = null;
                    updatePageDisplay(uploadedPages[idx]);
                    const labelMap = { original: 'Ảnh gốc', scanner: 'Quét tài liệu (Scan)', contrast: 'Tương phản cao', bw: 'Trắng đen' };
                    showToast(`Đã áp dụng chế độ "${labelMap[filter]}" cho Trang ${idx + 1}!`, 'success');
                }
            });
        });

        // Thumbnail Click -> Lightbox
        pagesListContainer.querySelectorAll('.page-thumb-box').forEach(box => {
            box.addEventListener('click', () => {
                const idx = parseInt(box.getAttribute('data-idx'));
                if (uploadedPages[idx]) {
                    window.openLightbox(uploadedPages[idx].displayDataUrl);
                }
            });
        });

        // Crop Page Click
        pagesListContainer.querySelectorAll('.btn-crop-page').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-idx'));
                openImageCropper('page', idx);
            });
        });

        // Enable / Disable Grade button
        if (uploadedPages.length > 0) {
            btnGrade.disabled = false;
            btnGrade.classList.remove('disabled-btn');
            btnGrade.style.opacity = '1';
            btnGrade.style.cursor = 'pointer';
            btnGrade.classList.add('pulse-glow');
        } else {
            resetUploadArea();
        }
    }

    if (btnClearAllPages) {
        btnClearAllPages.addEventListener('click', (e) => {
            e.stopPropagation();
            resetUploadArea();
        });
    }

    // Nút "⚡ Quét nét tất cả" - áp dụng Document Scanner cho toàn bộ các trang bài làm
    const btnEnhanceAllPages = document.getElementById('btn-enhance-all-pages');
    if (btnEnhanceAllPages) {
        btnEnhanceAllPages.addEventListener('click', () => {
            if (uploadedPages.length === 0) return;
            uploadedPages.forEach(p => {
                p.filterMode = 'scanner';
                p.optimizedBlob = null;
            });
            document.querySelectorAll('.btn-filter-preset').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-preset') === 'scanner');
            });
            let done = 0;
            uploadedPages.forEach(p => {
                const img = new Image();
                img.onload = () => {
                    let canvas = getRotatedCanvas(img, p.rotation, 800);
                    canvas = applyDocumentFilter(canvas, 'scanner');
                    p.displayDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    done++;
                    if (done === uploadedPages.length) renderUploadedPagesList();
                };
                img.onerror = () => {
                    done++;
                    if (done === uploadedPages.length) renderUploadedPagesList();
                };
                img.src = p.originalDataUrl;
            });
            showToast('⚡ Đã quét nét & làm trắng nền giấy cho toàn bộ các trang bài làm!', 'success');
        });
    }

    // Các nút preset bộ lọc toàn bài (Gốc, Scan, Tương phản, Trắng đen)
    document.querySelectorAll('.btn-filter-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-preset');
            document.querySelectorAll('.btn-filter-preset').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (uploadedPages.length === 0) return;
            uploadedPages.forEach(p => {
                p.filterMode = preset;
                p.optimizedBlob = null;
            });
            let done = 0;
            uploadedPages.forEach(p => {
                const img = new Image();
                img.onload = () => {
                    let canvas = getRotatedCanvas(img, p.rotation, 800);
                    if (preset !== 'original') {
                        canvas = applyDocumentFilter(canvas, preset);
                    }
                    p.displayDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    done++;
                    if (done === uploadedPages.length) renderUploadedPagesList();
                };
                img.onerror = () => {
                    done++;
                    if (done === uploadedPages.length) renderUploadedPagesList();
                };
                img.src = p.originalDataUrl;
            });
            const labelMap = { original: 'Ảnh gốc', scanner: 'Quét tài liệu (Scan)', contrast: 'Tương phản cao', bw: 'Trắng đen' };
            showToast(`⚡ Đã chuyển toàn bộ các trang sang chế độ: ${labelMap[preset]}!`, 'success');
        });
    });

    // Input tải thêm trang (file-input-more)
    if (fileInputMore) {
        fileInputMore.addEventListener('change', function(e) {
            e.stopPropagation();
            if (this.files && this.files.length > 0) {
                handleFiles(this.files);
            }
            this.value = '';
        });
    }

    // Hỗ trợ dán ảnh từ Clipboard bằng nút bấm
    async function pasteImageFromClipboard() {
        try {
            if (navigator.clipboard && navigator.clipboard.read) {
                const items = await navigator.clipboard.read();
                const files = [];
                for (const item of items) {
                    for (const type of item.types) {
                        if (type.startsWith('image/')) {
                            const blob = await item.getType(type);
                            files.push(new File([blob], `clipboard_${Date.now()}.png`, { type }));
                        }
                    }
                }
                if (files.length > 0) {
                    handleFiles(files);
                    showToast('Đã dán ảnh từ clipboard thành công!', 'success');
                    return;
                }
            }
        } catch (err) {
            console.warn('Clipboard read error or not permitted:', err);
        }
        showToast('Hãy nhấn tổ hợp phím Ctrl + V (hoặc Cmd + V trên Mac) để dán ảnh bài làm trực tiếp!', 'info');
    }

    if (btnPasteClipboard) {
        btnPasteClipboard.addEventListener('click', (e) => {
            e.stopPropagation();
            pasteImageFromClipboard();
        });
    }

    // Bộ tạo ảnh bài làm mẫu môn Toán THCS để thử nghiệm ngay lập tức
    function generateSampleMathPage() {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 1600;
        const ctx = canvas.getContext('2d');

        // Nền trang vở ô ly học sinh Việt Nam
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Kẻ ô ly xanh ngọc nhạt
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 1;
        for (let x = 40; x < canvas.width; x += 30) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 40; y < canvas.height; y += 30) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        // Đường lề đỏ kẻ dọc
        ctx.strokeStyle = '#fca5a5';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(140, 0);
        ctx.lineTo(140, canvas.height);
        ctx.stroke();

        // Tiêu đề & Thông tin học sinh (màu mực bút bi xanh học trò)
        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
        ctx.fillText('BÀI KIỂM TRA 15 PHÚT - ĐẠI SỐ 8', 260, 90);

        ctx.font = 'italic 20px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#1e40af';
        ctx.fillText('Họ và tên: Nguyễn Văn An - Lớp: 8A1', 170, 140);
        ctx.fillText('Ngày: 25/09/2026', 820, 140);

        // Kẻ ngang phân cách
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(170, 160);
        ctx.lineTo(1050, 160);
        ctx.stroke();

        // Câu 1: Phân tích đa thức thành nhân tử
        ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#0f172a';
        ctx.fillText('Câu 1 (3,0 điểm): Phân tích đa thức sau thành nhân tử: A = x² - 4x + 4 - y²', 170, 210);

        ctx.font = 'normal 21px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#1d4ed8';
        ctx.fillText('Bài làm:', 170, 255);
        ctx.fillText('Ta có: A = (x² - 4x + 4) - y²', 200, 300);
        ctx.fillText('        = (x - 2)² - y²', 200, 345);
        ctx.fillText('        = (x - 2 - y)(x - 2 + y)', 200, 390);
        ctx.fillText('Vậy A = (x - y - 2)(x + y - 2)', 200, 435);

        // Phân cách
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(170, 475);
        ctx.lineTo(1050, 475);
        ctx.stroke();

        // Câu 2: Giải phương trình (có 1 lỗi chuyển vế để AI phát hiện lỗi chính xác)
        ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#0f172a';
        ctx.fillText('Câu 2 (4,0 điểm): Giải phương trình: 2x(x - 3) - (2x + 1)(x - 2) = 5', 170, 525);

        ctx.font = 'normal 21px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#1d4ed8';
        ctx.fillText('Bài làm:', 170, 570);
        ctx.fillText('Phương trình tương đương:', 200, 615);
        ctx.fillText('2x² - 6x - (2x² - 4x + x - 2) = 5', 200, 660);
        ctx.fillText('2x² - 6x - 2x² + 3x + 2 = 5', 200, 705);
        ctx.fillText('-3x + 2 = 5', 200, 750);
        ctx.fillText('-3x = 5 + 2', 200, 795); // Lỗi chuyển vế: +2 chuyển vế thành +2
        ctx.fillText('-3x = 7', 200, 840);
        ctx.fillText('x = -7/3', 200, 885);
        ctx.fillText('Vậy tập nghiệm của phương trình là S = {-7/3}', 200, 930);

        // Câu 3: Rút gọn phân thức
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(170, 975);
        ctx.lineTo(1050, 975);
        ctx.stroke();

        ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#0f172a';
        ctx.fillText('Câu 3 (3,0 điểm): Cho biểu thức B = (x + 3)/(x - 3) - (x - 3)/(x + 3). Rút gọn B với x ≠ ±3', 170, 1025);

        ctx.font = 'normal 21px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#1d4ed8';
        ctx.fillText('Bài làm:', 170, 1070);
        ctx.fillText('Với ĐKXĐ: x ≠ 3 và x ≠ -3, ta có:', 200, 1115);
        ctx.fillText('B = [(x + 3)² - (x - 3)²] / [(x - 3)(x + 3)]', 200, 1160);
        ctx.fillText('  = (x² + 6x + 9 - x² + 6x - 9) / (x² - 9)', 200, 1205);
        ctx.fillText('  = 12x / (x² - 9)', 200, 1250);
        ctx.fillText('Vậy với x ≠ ±3 thì B = 12x / (x² - 9)', 200, 1295);

        return canvas.toDataURL('image/jpeg', 0.92);
    }

    function loadSampleMathHomework() {
        try {
            const dataUrl = generateSampleMathPage();
            // Chuyển DataURL thành Blob & File
            const byteString = atob(dataUrl.split(',')[1]);
            const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: mimeString });
            const file = new File([blob], 'Bai_kiem_tra_Toan_8_mau.jpg', { type: 'image/jpeg' });

            uploadedPages.push({
                id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                file: file,
                name: file.name,
                size: file.size,
                width: 1200,
                height: 1600,
                rotation: 0,
                originalDataUrl: dataUrl,
                displayDataUrl: dataUrl,
                optimizedBlob: blob
            });
            selectedFileUrl = dataUrl;
            renderUploadedPagesList();
            showToast('Đã tải bài làm Toán mẫu thành công! Bạn có thể nhấn "CHẤM BÀI" để kiểm tra ngay.', 'success');
        } catch (err) {
            console.error('Lỗi tạo bài mẫu:', err);
            showToast('Không thể tạo ảnh mẫu: ' + err.message, 'error');
        }
    }

    if (btnSampleMath) {
        btnSampleMath.addEventListener('click', (e) => {
            e.stopPropagation();
            loadSampleMathHomework();
        });
    }

    // Ngăn chặn trình duyệt mở ảnh khi thả nhầm bên ngoài dropZone
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    // --- DRAG & DROP LOGIC ---
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
        dropZone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });
    
    dropZone.addEventListener('dragover', () => {
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    
    dropZone.addEventListener('drop', (e) => {
        dropZone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    });

    // Lắng nghe phím tắt Dán ảnh (Ctrl + V / Cmd + V) từ Clipboard
    window.addEventListener('paste', (e) => {
        if (!e.clipboardData) return;
        const items = e.clipboardData.items || [];
        const pastedFiles = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.indexOf('image') !== -1) {
                const f = items[i].getAsFile();
                if (f) pastedFiles.push(f);
            }
        }
        if (pastedFiles.length > 0) {
            handleFiles(pastedFiles);
            return;
        }
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            handleFiles(e.clipboardData.files);
        }
    });

    // Gắn sự kiện lắng nghe tệp được chọn cho tất cả các nút tải ảnh
    [fileInput, fileInputBtn, fileInputMore].forEach(input => {
        if (input) {
            input.addEventListener('change', function(e) {
                if (this.files && this.files.length > 0) {
                    handleFiles(this.files);
                }
                this.value = ''; // Luôn reset để chọn lại cùng một ảnh vẫn kích hoạt sự kiện
            });
        }
    });

    function resetUploadArea() {
        uploadedPages = [];
        selectedFileUrl = null;
        if (fileInput) {
            fileInput.value = '';
            fileInput.style.display = 'block';
        }
        if (fileInputBtn) fileInputBtn.value = '';
        if (fileInputMore) fileInputMore.value = '';
        uploadPreview.classList.add('hidden');
        uploadDefault.classList.remove('hidden');
        dropZone.style.borderStyle = 'dashed';
        dropZone.style.borderColor = 'rgba(37, 99, 235, 0.3)';

        btnGrade.disabled = true;
        btnGrade.classList.add('disabled-btn');
        btnGrade.style.opacity = '';
        btnGrade.style.cursor = '';
        btnGrade.classList.remove('pulse-glow');
    }

    // --- HISTORY MODAL CONTROLLER ---
    const historyModal = document.getElementById('history-modal');
    const btnOpenHistory = document.getElementById('btn-open-history');
    const btnCloseHistory = document.getElementById('btn-close-history');
    const btnClearAllHistory = document.getElementById('btn-clear-all-history');
    const historySearchInput = document.getElementById('history-search-input');
    const historyListContainer = document.getElementById('history-list-container');

    async function renderHistoryList(filterQuery = '') {
        if (!historyListContainer) return;
        const allItems = await MatsudaDB.getAllHistory();
        const query = (filterQuery || '').toLowerCase().trim();

        const filtered = query
            ? allItems.filter(it => 
                (it.title || '').toLowerCase().includes(query) ||
                (it.studentName || '').toLowerCase().includes(query) ||
                (it.studentClass || '').toLowerCase().includes(query) ||
                (it.dateDisplay || '').toLowerCase().includes(query) ||
                (it.summary || '').toLowerCase().includes(query)
            )
            : allItems;

        if (filtered.length === 0) {
            historyListContainer.innerHTML = `
                <div class="history-empty-state">
                    <div class="history-empty-icon">📭</div>
                    <div style="font-weight: 600; font-size: 15px; color: #1e293b;">${query ? 'Không tìm thấy kết quả phù hợp' : 'Chưa có bài chấm nào được lưu'}</div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${query ? 'Vui lòng thử tìm kiếm bằng từ khóa khác' : 'Các bài chấm thành công sẽ tự động được lưu an toàn tại đây'}</div>
                </div>
            `;
            return;
        }

        historyListContainer.innerHTML = '';
        filtered.forEach(item => {
            const firstImg = (item.images && item.images.length > 0) ? item.images[0].dataUrl : '';
            const scoreVal = typeof item.score === 'number' ? item.score.toFixed(1) : '0';
            const pageCount = (item.images && item.images.length > 0) ? item.images.length : 1;
            
            const card = document.createElement('div');
            card.className = 'history-item-card';
            card.innerHTML = `
                <div class="history-item-thumb">
                    ${firstImg ? `<img src="${firstImg}" alt="Thumbnail">` : '<span style="font-size: 24px;">📄</span>'}
                </div>
                <div class="history-item-body">
                    <div class="history-item-title">${escapeHtml(item.title || 'Bài kiểm tra Toán')}</div>
                    <div class="history-item-meta">
                        <span>👤 ${escapeHtml(item.studentName || 'Học sinh')} (${escapeHtml(item.studentClass || 'THCS')})</span>
                        <span>📅 ${escapeHtml(item.dateDisplay || '')}</span>
                        <span>📄 ${pageCount} trang</span>
                    </div>
                    <div style="font-size: 12px; color: #475569; margin-top: 2px;">
                        ${escapeHtml(item.summary ? item.summary.slice(0, 90) + '...' : '')}
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
                    <div class="history-score-pill">${scoreVal}/10</div>
                    <div class="history-actions">
                        <button type="button" class="btn btn-primary btn-sm btn-reopen-history" data-id="${item.id}">👁 Xem lại</button>
                        <button type="button" class="btn btn-outline btn-sm btn-delete-history" data-id="${item.id}" style="color: #ef4444; border-color: #fca5a5;">🗑 Xóa</button>
                    </div>
                </div>
            `;
            historyListContainer.appendChild(card);
        });

        // Reopen historical item WITHOUT calling Gemini
        historyListContainer.querySelectorAll('.btn-reopen-history').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                const target = allItems.find(it => it.id === id);
                if (target && target.gradingData) {
                    currentGradingSessionId = target.id;
                    currentGradingData = target.gradingData;
                    currentGradingImages = target.images || [];
                    if (currentGradingImages.length > 0) {
                        selectedFileUrl = currentGradingImages[0].dataUrl;
                    }

                    // Pre-fill student info inputs
                    const inName = document.getElementById('info-student-name');
                    if (inName) inName.value = target.studentName || '';
                    const inClass = document.getElementById('info-student-class');
                    if (inClass) inClass.value = target.studentClass || '';
                    const inTitle = document.getElementById('info-lesson-title');
                    if (inTitle) inTitle.value = target.title || '';
                    const inDate = document.getElementById('info-grading-date');
                    if (inDate) inDate.value = target.dateDisplay || '';

                    historyModal.classList.add('hidden');
                    sectionUpload.classList.add('hidden');
                    sectionResult.classList.remove('hidden');

                    renderResult(currentGradingData);
                }
            });
        });

        // Delete single item
        historyListContainer.querySelectorAll('.btn-delete-history').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                if (confirm('Bạn có muốn xóa bài chấm này khỏi lịch sử không?')) {
                    await MatsudaDB.deleteHistory(id);
                    await updateHistoryBadge();
                    renderHistoryList(historySearchInput ? historySearchInput.value : '');
                }
            });
        });
    }

    if (btnOpenHistory && historyModal) {
        btnOpenHistory.addEventListener('click', () => {
            historyModal.classList.remove('hidden');
            if (historySearchInput) historySearchInput.value = '';
            renderHistoryList();
        });
    }

    if (btnCloseHistory && historyModal) {
        btnCloseHistory.addEventListener('click', () => {
            historyModal.classList.add('hidden');
        });
    }

    if (historyModal) {
        historyModal.addEventListener('click', (e) => {
            if (e.target === historyModal) historyModal.classList.add('hidden');
        });
    }

    if (historySearchInput) {
        historySearchInput.addEventListener('input', (e) => {
            renderHistoryList(e.target.value);
        });
    }

    if (btnClearAllHistory) {
        btnClearAllHistory.addEventListener('click', async () => {
            if (confirm('Bạn có chắc chắn muốn xóa TOÀN BỘ lịch sử chấm bài không? Thao tác này không thể hoàn tác.')) {
                await MatsudaDB.clearAllHistory();
                await updateHistoryBadge();
                renderHistoryList();
            }
        });
    }

    // --- SPRINT 4: GỌI API GEMINI QUA FASTAPI ---
    const modal = document.getElementById('demo-modal');
    const loadingText = document.getElementById('loading-text');
    const modalFinalMsg = document.getElementById('modal-final-msg');
    
    // Cập nhật huy hiệu xếp loại và nhận xét động
    function updateVerdictBadge(score) {
        const badge = document.getElementById('score-verdict-badge');
        const icon = document.getElementById('verdict-icon');
        const text = document.getElementById('verdict-text');
        if (!badge || !icon || !text) return;

        badge.className = 'verdict-badge';
        if (score >= 9.0) {
            badge.classList.add('badge-excellent');
            icon.innerText = '🌟';
            text.innerText = 'Xuất sắc · Bài làm rất tuyệt vời!';
        } else if (score >= 8.0) {
            badge.classList.add('badge-good');
            icon.innerText = '🎉';
            text.innerText = 'Giỏi · Nắm rất chắc kiến thức!';
        } else if (score >= 6.5) {
            badge.classList.add('badge-fair');
            icon.innerText = '👍';
            text.innerText = 'Khá · Kỹ năng làm bài tốt';
        } else if (score >= 5.0) {
            badge.classList.add('badge-fair');
            icon.innerText = '📈';
            text.innerText = 'Trung bình · Cần rèn thêm tính toán';
        } else {
            badge.classList.add('badge-needs-work');
            icon.innerText = '🌱';
            text.innerText = 'Cần cố gắng · Xem kỹ các lỗi bên dưới';
        }
    }

    // Animation điểm số và thanh phổ điểm
    function triggerScoreAnimation(targetScore) {
        let current = 0;
        const target = Math.max(0, Math.min(10, typeof targetScore === 'number' ? targetScore : 0));
        const interval = setInterval(() => {
            current += 0.1;
            if (current >= target) {
                current = target;
                clearInterval(interval);
            }
            if (animatedScore) animatedScore.innerText = current.toFixed(1);
        }, 15);
        
        setTimeout(() => {
            if (scoreMarker) {
                scoreMarker.style.left = `calc(${target * 10}% - 9px)`; 
            }
            updateVerdictBadge(target);
        }, 100);
    }

    // Toggle ẩn/hiện lời giải mẫu cho từng câu
    window.toggleRefSolution = function(idx) {
        const body = document.getElementById(`ref-content-body-${idx}`);
        const btn = document.getElementById(`btn-toggle-ref-${idx}`);
        if (!body || !btn) return;
        if (body.style.display === 'none') {
            body.style.display = 'block';
            btn.innerText = 'Thu gọn đáp án';
        } else {
            body.style.display = 'none';
            btn.innerText = 'Mở rộng đáp án';
        }
    };

    // --- LATEX / KATEX RENDERING & MATH SANITIZATION UTILITIES ---
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Tự động làm sạch và sửa chữa triệt để mọi lỗi escape LaTeX (đặc biệt \times bị biến thành \t + imes, \text, \boxed, \frac...)
    function sanitizeMathData(val) {
        if (!val) return val;
        if (typeof val === 'string') {
            return val
                .replace(/[\t\\]?imes\b/g, '\\cdot')
                .replace(/\\times\b/g, '\\cdot')
                .replace(/([0-9a-zA-Z\)\}])\s*imes\s*([0-9a-zA-Z\(\{])/g, '$1 \\cdot $2')
                .replace(/[\t\\]?ext\{/g, '\\text{')
                .replace(/[\x08\\]?oxed\{/g, '\\boxed{')
                .replace(/[\x0c\\]?rac\{/g, '\\frac{')
                .replace(/[\x08\\]?egin\{/g, '\\begin{');
        }
        if (Array.isArray(val)) {
            return val.map(sanitizeMathData);
        }
        if (typeof val === 'object') {
            const out = {};
            for (const k of Object.keys(val)) {
                out[k] = sanitizeMathData(val[k]);
            }
            return out;
        }
        return val;
    }

    // Normalizer: Tự động chuẩn hóa mọi chuỗi công thức thành LaTeX đẹp chuẩn mực
    function normalizeMathToLatex(raw) {
        if (!raw) return '';
        let s = String(raw).trim();

        // 0. Sửa lỗi thoát chuỗi escape JSON (\times -> \t + imes, \text -> \t + ext...)
        s = s.replace(/\\times\b/g, ' \\cdot ');
        s = s.replace(/[\t\\]imes\b/g, ' \\cdot ');
        s = s.replace(/([0-9a-zA-Z\)\}])\s*imes\s*([0-9a-zA-Z\(\{])/g, '$1 \\cdot $2');
        s = s.replace(/\x0crac\{/g, '\\frac{');
        s = s.replace(/(?:\\+f+|\f)+\\*(?:frac\{|rac\{)/g, '\\frac{');
        s = s.replace(/[\t\\]ext\{/g, '\\text{');
        s = s.replace(/[\x08\\]oxed\{/g, '\\boxed{');
        s = s.replace(/[\x08\\]egin\{/g, '\\begin{');

        // 1. Gỡ bỏ ký hiệu bao bọc dư thừa $...$, $$...$$, \(...\), \[...\]
        if ((s.startsWith('$$') && s.endsWith('$$')) || (s.startsWith('\\[') && s.endsWith('\\]'))) {
            s = s.slice(2, -2).trim();
        } else if (s.startsWith('$') && s.endsWith('$') && s.length >= 2) {
            s = s.slice(1, -1).trim();
        } else if (s.startsWith('\\(') && s.endsWith('\\)') && s.length >= 4) {
            s = s.slice(2, -2).trim();
        }

        // 2. Tự động bọc ngoặc nhọn cho số mũ nhiều chữ số hoặc số âm (vd: ^10 -> ^{10}, ^-5 -> ^{-5})
        s = s.replace(/\^([0-9]{2,})/g, '^{$1}');
        s = s.replace(/\^(-[0-9]+)/g, '^{$1}');

        // 3. Chuẩn hóa phép nhân: dấu * hoặc dấu chấm giữa các nhân tử -> \cdot
        s = s.replace(/\s*\*\s*/g, ' \\cdot ');
        s = s.replace(/([\d\)\}a-zA-Z])\s*[\.·]\s*([\d\(\{a-zA-Z])/g, '$1 \\cdot $2');

        // 4. Tự động chuyển đổi phân số dạng gạch chéo / thành \frac{tử}{mẫu} (kể cả chuỗi đẳng thức liên tiếp: A/B = C/D)
        if (!s.includes('\\frac') && s.includes('/')) {
            const parts = s.split('=');
            const converted = parts.map(part => {
                const p = part.trim();
                if (!p.includes('/')) return p;
                const slashIdx = p.indexOf('/');
                let num = p.substring(0, slashIdx).trim();
                let den = p.substring(slashIdx + 1).trim();
                if (num.startsWith('(') && num.endsWith(')')) num = num.slice(1, -1).trim();
                if (den.startsWith('(') && den.endsWith(')')) den = den.slice(1, -1).trim();
                return `\\frac{${num}}{${den}}`;
            });
            s = converted.join(' = ');
        }

        return s;
    }

    function renderLatexToHtml(latexStr, displayMode = false) {
        if (!latexStr) return '';
        const trimmed = String(latexStr).trim();
        if (window.katex) {
            try {
                let cleaned = normalizeMathToLatex(trimmed);
                if (cleaned.startsWith('$$') && cleaned.endsWith('$$') && cleaned.length >= 4) {
                    cleaned = cleaned.slice(2, -2).trim();
                    displayMode = true;
                } else if (cleaned.startsWith('\\[') && cleaned.endsWith('\\]') && cleaned.length >= 4) {
                    cleaned = cleaned.slice(2, -2).trim();
                    displayMode = true;
                } else if (cleaned.startsWith('$') && cleaned.endsWith('$') && cleaned.length >= 2) {
                    cleaned = cleaned.slice(1, -1).trim();
                } else if (cleaned.startsWith('\\(') && cleaned.endsWith('\\)') && cleaned.length >= 4) {
                    cleaned = cleaned.slice(2, -2).trim();
                }

                // Nếu có chứa phân số \frac hoặc căn \sqrt thì luôn ưu tiên \displaystyle để nét gạch ngang và chữ số rõ nét, không bị teo nhỏ
                if (!displayMode && (cleaned.includes('\\frac') || cleaned.includes('\\sqrt') || cleaned.length > 25)) {
                    cleaned = '\\displaystyle ' + cleaned;
                }

                return window.katex.renderToString(cleaned, {
                    displayMode: displayMode,
                    throwOnError: false,
                    output: 'html' // Chế độ HTML thuần tối ưu nhất cho cả hiển thị Web và xuất PDF / Ảnh A4
                });
            } catch (err) {
                console.warn('KaTeX render error:', err);
            }
        }
        return `<code>${escapeHtml(trimmed)}</code>`;
    }

    function formatMathText(text) {
        if (!text) return '';
        let str = String(text).trim();

        // Sửa lỗi imes và các escape bị lỗi trước khi nhận diện công thức
        str = str.replace(/\\times\b/g, ' \\cdot ');
        str = str.replace(/[\t\\]imes\b/g, ' \\cdot ');
        str = str.replace(/([0-9a-zA-Z\)\}])\s*imes\s*([0-9a-zA-Z\(\{])/g, '$1 \\cdot $2');
        str = str.replace(/\x0crac\{/g, '\\frac{');
        str = str.replace(/(?:\\+f+|\f)+\\*(?:frac\{|rac\{)/g, '\\frac{');
        str = str.replace(/[\t\\]ext\{/g, '\\text{');
        str = str.replace(/[\x08\\]oxed\{/g, '\\boxed{');
        str = str.replace(/[\x08\\]egin\{/g, '\\begin{');
        
        // 1. Khối công thức block: $$...$$ hoặc \[...\]
        str = str.replace(/(\$\$|\\\[)([\s\S]*?)(\$\$|\\\])/g, (match, open, math) => {
            return `<div class="katex-display">${renderLatexToHtml(math, true)}</div>`;
        });
        
        // 2. Khối công thức inline: $...$ hoặc \(...\)
        str = str.replace(/(\$|\\\()([^\$\n\r]+?)(\$|\\\))/g, (match, open, math) => {
            return renderLatexToHtml(math, false);
        });

        // 3. Tự động nhận diện phân số số học nằm trong văn bản (vd: "đáp số 2/9", "hệ số 3/4")
        str = str.replace(/(^|[\s\(])(\d+)\/(\d+)([\s\)\.,;!\?]|$)/g, (match, pre, num, den, post) => {
            return `${pre}${renderLatexToHtml(`\\frac{${num}}{${den}}`, false)}${post}`;
        });

        // 4. Nhận diện các lệnh LaTeX (vd: \frac, \sqrt, \boxed, \cdot)
        str = str.replace(/(\\frac\{[^{}]+\}\{[^{}]+\}|\\sqrt\{[^{}]+\}|\\boxed\{[^{}]+\})/g, (m) => {
            return renderLatexToHtml(m, false);
        });

        // 5. Tự động nhận diện các biểu thức lũy thừa / chỉ số dưới (vd: 4^2, (-1)^9, 6^7, x^2, a_1, (-9)^7, 25^3, 6^5.(-12)^6)
        str = str.replace(/(?:\(-?\d+\)|\d+|[a-zA-Z])(?:\^\{[^{}]+\}|\^\d+|_\{[^{}]+\}|_\d+)(?:[\.\*·](?:\(-?\d+\)|\d+|[a-zA-Z])(?:\^\{[^{}]+\}|\^\d+|_\{[^{}]+\}|_\d+))*/g, (m) => {
            return renderLatexToHtml(m, false);
        });

        // 6. Nhận diện các đẳng thức ngắn đơn lẻ (vd: x = 2, y = -1)
        str = str.replace(/(^|[\s\(])([a-zA-Z]\s*=\s*-?\d+(?:\/\d+)?)([\s\)\.,;!\?]|$)/g, (match, pre, eq, post) => {
            return `${pre}${renderLatexToHtml(eq, false)}${post}`;
        });

        return str;
    }

    // State Management
    let currentGradingData = null;
    let currentViewMode = 'teacher'; // 'teacher' | 'student'
    let currentGradingSessionId = null; // ID in IndexedDB if saved
    let exportOptions = {
        totalScore: true,
        questionScores: true,
        studentImg: true,
        stepAnalysis: true,
        firstError: true,
        corrections: true,
        overallFeedback: true,
        referenceSolution: false,
        remedialExercises: true
    };

    // Auto-fill grading date
    const infoGradingDate = document.getElementById('info-grading-date');
    if (infoGradingDate) {
        infoGradingDate.value = new Date().toLocaleDateString('vi-VN');
    }

    // Modal Lightbox Controller with Interactive Zoom and Page Navigation
    const lightboxModal = document.getElementById('image-lightbox-modal');
    const lightboxFullImg = document.getElementById('lightbox-full-img');
    const btnCloseLightbox = document.getElementById('btn-close-lightbox');
    const btnLbPrev = document.getElementById('btn-lb-prev');
    const btnLbNext = document.getElementById('btn-lb-next');
    const btnLbZoomIn = document.getElementById('btn-lb-zoom-in');
    const btnLbZoomOut = document.getElementById('btn-lb-zoom-out');
    const btnLbZoomReset = document.getElementById('btn-lb-zoom-reset');
    const lbZoomLevel = document.getElementById('lb-zoom-level');
    const lightboxPageIndicator = document.getElementById('lightbox-page-indicator');

    let currentLightboxPageIndex = 0;
    let currentLightboxZoom = 1.0;

    function applyLightboxZoom() {
        if (!lightboxFullImg) return;
        lightboxFullImg.style.transform = `scale(${currentLightboxZoom})`;
        if (lbZoomLevel) {
            lbZoomLevel.innerText = `${Math.round(currentLightboxZoom * 100)}%`;
        }
    }

    function updateLightboxDisplay() {
        const images = (currentGradingImages && currentGradingImages.length > 0)
            ? currentGradingImages
            : (selectedFileUrl ? [{ pageIndex: 0, dataUrl: selectedFileUrl }] : []);

        if (images.length === 0) return;

        if (currentLightboxPageIndex < 0) currentLightboxPageIndex = 0;
        if (currentLightboxPageIndex >= images.length) currentLightboxPageIndex = images.length - 1;

        if (lightboxFullImg) {
            lightboxFullImg.src = images[currentLightboxPageIndex].dataUrl;
        }

        if (lightboxPageIndicator) {
            lightboxPageIndicator.innerText = `Trang ${currentLightboxPageIndex + 1}/${images.length}`;
        }

        if (btnLbPrev) btnLbPrev.disabled = currentLightboxPageIndex === 0;
        if (btnLbNext) btnLbNext.disabled = currentLightboxPageIndex >= images.length - 1;

        currentLightboxZoom = 1.0;
        applyLightboxZoom();
    }

    window.openLightbox = function(targetSrc, pageIdx = null) {
        const images = (currentGradingImages && currentGradingImages.length > 0)
            ? currentGradingImages
            : (selectedFileUrl ? [{ pageIndex: 0, dataUrl: selectedFileUrl }] : []);

        if (pageIdx !== null && pageIdx >= 0 && pageIdx < images.length) {
            currentLightboxPageIndex = pageIdx;
        } else if (targetSrc) {
            const foundIdx = images.findIndex(img => img.dataUrl === targetSrc);
            currentLightboxPageIndex = foundIdx !== -1 ? foundIdx : 0;
        } else {
            currentLightboxPageIndex = 0;
        }

        updateLightboxDisplay();
        if (lightboxModal) lightboxModal.classList.remove('hidden');
    };

    if (btnLbPrev) {
        btnLbPrev.addEventListener('click', () => {
            if (currentLightboxPageIndex > 0) {
                currentLightboxPageIndex--;
                updateLightboxDisplay();
            }
        });
    }

    if (btnLbNext) {
        btnLbNext.addEventListener('click', () => {
            const images = currentGradingImages || [];
            if (currentLightboxPageIndex < images.length - 1) {
                currentLightboxPageIndex++;
                updateLightboxDisplay();
            }
        });
    }

    if (btnLbZoomIn) {
        btnLbZoomIn.addEventListener('click', () => {
            currentLightboxZoom = Math.min(3.0, currentLightboxZoom + 0.25);
            applyLightboxZoom();
        });
    }

    if (btnLbZoomOut) {
        btnLbZoomOut.addEventListener('click', () => {
            currentLightboxZoom = Math.max(0.5, currentLightboxZoom - 0.25);
            applyLightboxZoom();
        });
    }

    if (btnLbZoomReset) {
        btnLbZoomReset.addEventListener('click', () => {
            currentLightboxZoom = 1.0;
            applyLightboxZoom();
        });
    }

    window.switchStudentWorkPage = function(questionIdx, pageIdx) {
        activeStudentPageByQuestion[questionIdx] = pageIdx;
        const card = document.getElementById(`student-work-card-${questionIdx}`);
        if (!card) return;
        const btns = card.querySelectorAll('.page-tab-btn');
        btns.forEach((b, i) => {
            if (i === pageIdx) b.classList.add('active');
            else b.classList.remove('active');
        });
        const img = document.getElementById(`student-work-img-${questionIdx}`);
        if (img && currentGradingImages && currentGradingImages[pageIdx]) {
            img.src = currentGradingImages[pageIdx].dataUrl;
        }
    };

    window.openLightboxForQuestion = function(questionIdx) {
        const pageIdx = activeStudentPageByQuestion[questionIdx] || 0;
        window.openLightbox(null, pageIdx);
    };

    if (btnCloseLightbox) {
        btnCloseLightbox.addEventListener('click', () => {
            if (lightboxModal) lightboxModal.classList.add('hidden');
        });
    }
    if (lightboxModal) {
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) {
                lightboxModal.classList.add('hidden');
            }
        });
    }

    // --- MỤC 2: HỆ THỐNG BÀI TẬP BỔ TRỢ CÁ NHÂN HÓA CHUẨN THEO KHỐI LỚP (TOÁN THCS 6-7-8-9) ---
    function generateRemedialQuestions(data) {
        if (!data || !data.questions || data.questions.length === 0) return [];

        const flawedQuestions = [];
        data.questions.forEach((q, idx) => {
            const isCor = q.status === 'correct';
            const score = q.score !== undefined ? q.score : 0;
            const maxScore = q.maxScore || q.max_score || 10;
            const hasError = !isCor || score < maxScore || (q.analysis && q.analysis.some(s => s.status !== 'correct'));
            if (hasError) {
                flawedQuestions.push({ q, idx });
            }
        });

        // Xác định khối lớp thực tế của học sinh (từ phân loại câu hỏi hoặc ô nhập thông tin lớp)
        const classInput = (document.getElementById('info-student-class')?.value || '').trim().toLowerCase();
        let defaultGrade = 7; // Mặc định lớp 7 nếu chưa có thông tin
        if (classInput.startsWith('6') || classInput.includes('lớp 6')) defaultGrade = 6;
        else if (classInput.startsWith('7') || classInput.includes('lớp 7')) defaultGrade = 7;
        else if (classInput.startsWith('8') || classInput.includes('lớp 8')) defaultGrade = 8;
        else if (classInput.startsWith('9') || classInput.includes('lớp 9')) defaultGrade = 9;

        // Nếu học sinh không có câu sai: KHÔNG tự nhảy sang bài thử thách khác chuyên đề.
        // Chỉ dùng bài isomorphic mà backend đã sinh bám đúng đề gốc; nếu không có thì không hiển thị.
        if (flawedQuestions.length === 0) {
            const sameScope = data.questions
                .map((q, idx) => ({ q, idx }))
                .filter(({ q }) => q.remedialExercise && q.remedialExercise.problemLatex);
            if (sameScope.length === 0) return [];
            sameScope.slice(0, 1).forEach(item => flawedQuestions.push(item));
        }

        const remedialList = [];

        flawedQuestions.forEach(({ q, idx }) => {
            const qId = q.questionId || q.question || `Câu ${idx + 1}`;
            const qGradeRaw = (q.classification?.grade || '').toLowerCase();
            let qGrade = defaultGrade;
            if (qGradeRaw.includes('6')) qGrade = 6;
            else if (qGradeRaw.includes('7')) qGrade = 7;
            else if (qGradeRaw.includes('8')) qGrade = 8;
            else if (qGradeRaw.includes('9')) qGrade = 9;

            const textAll = `${q.problemStatementLatex || ''} ${q.classification?.topic || ''} ${q.classification?.subtopic || ''} ${q.classification?.problemType || ''} ${q.feedback || ''}`.toLowerCase();

            // Tìm nguyên nhân lỗi đầu tiên hoặc lỗi nổi bật của học sinh
            let errReason = '';
            if (q.analysis && q.analysis.length > 0) {
                const firstErr = q.analysis.find(s => s.isFirstError) || q.analysis.find(s => s.status !== 'correct');
                if (firstErr && firstErr.comment) {
                    errReason = firstErr.comment;
                }
            }
            if (!errReason && q.feedback) errReason = q.feedback;

            // ========================================================
            // TẦNG 1: ƯU TIÊN SỐ 1 - BÀI TẬP DO GIÁO VIÊN ĐÃ CHỈNH SỬA HOẶC RE-ROLL
            // ========================================================
            if (q.customRemedialExercise && q.customRemedialExercise.problemLatex) {
                remedialList.push({
                    id: `rem_${idx}_custom`,
                    questionIndex: idx,
                    targetQuestion: `Câu ${qId}`,
                    isAiGenerated: true,
                    isCustom: true,
                    title: q.customRemedialExercise.title || `🎯 Rèn luyện kiến thức Câu ${qId}`,
                    weakness: q.customRemedialExercise.weakness || errReason,
                    problemLatex: q.customRemedialExercise.problemLatex,
                    hint: q.customRemedialExercise.hint || '',
                    solutionLatex: q.customRemedialExercise.solutionLatex || '',
                    finalAnswer: q.customRemedialExercise.finalAnswer || ''
                });
                return;
            }

            // ========================================================
            // TẦNG 2: ƯU TIÊN SỐ 2 - BÀI TẬP TƯƠNG TỰ CÙNG DẠNG (ISOMORPHIC) DO AI SINH 1:1 TỪ ĐỀ BÀI GỐC
            // ========================================================
            if (q.remedialExercise && q.remedialExercise.problemLatex) {
                remedialList.push({
                    id: `rem_${idx}_ai`,
                    questionIndex: idx,
                    targetQuestion: `Câu ${qId}`,
                    isAiGenerated: true,
                    title: q.remedialExercise.title || `🎯 Rèn luyện: Dạng toán tương tự Câu ${qId}`,
                    weakness: q.remedialExercise.weakness || errReason,
                    problemLatex: q.remedialExercise.problemLatex,
                    hint: q.remedialExercise.hint || '',
                    solutionLatex: q.remedialExercise.solutionLatex || '',
                    finalAnswer: q.remedialExercise.finalAnswer || '',
                    methodAnchor: q.remedialExercise.methodAnchor || '',
                    curriculumCheck: q.remedialExercise.curriculumCheck || ''
                });
                return;
            }

            // Không có bài do AI sinh: bỏ qua thay vì dùng ngân hàng cứng có nguy cơ lệch bài/chương.
            // Ưu tiên đúng phạm vi hơn việc luôn phải hiện một bài tự luyện.
            return;

        });

        return remedialList;
    }

    // --- MỤC 2: RENDER BÀI TẬP BỔ TRỢ CÁ NHÂN HÓA TRÊN GIAO DIỆN KẾT QUẢ ---
    function renderRemedialPracticeCard(data) {
        const card = document.getElementById('remedial-practice-card');
        const listContainer = document.getElementById('remedial-questions-list');
        if (!card || !listContainer) return;

        const remedialItems = generateRemedialQuestions(data);
        if (!remedialItems || remedialItems.length === 0) {
            card.classList.add('hidden');
            return;
        }

        let html = '';
        remedialItems.forEach((rm, idx) => {
            const qIdx = (rm.questionIndex !== undefined) ? rm.questionIndex : idx;
            html += `
                <div class="remedial-item-card slide-up" data-remedial-id="${rm.id}">
                    <div class="remedial-item-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span class="remedial-topic-pill">Bài tập ${idx + 1}</span>
                            <strong style="color: #1e293b; font-size: 13.5px;">${formatMathText(rm.title)}</strong>
                            ${rm.isCustom ? `<span class="badge-tag" style="background: #fef3c7; color: #b45309; font-size: 10px; font-weight: 700; padding: 1.5px 6px; border-radius: 4px;">✏️ Đã sửa</span>` : (rm.isAiGenerated ? `<span class="badge-tag" style="background: #dbeafe; color: #1d4ed8; font-size: 10px; font-weight: 700; padding: 1.5px 6px; border-radius: 4px;">✨ AI sinh 1:1</span>` : '')}
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span class="remedial-target-badge">🎯 Củng cố cho ${escapeHtml(rm.targetQuestion)}</span>
                            <button type="button" class="btn btn-outline btn-sm btn-remedial-reroll" data-qidx="${qIdx}" title="AI sinh bài toán mới tương tự cùng dạng với số liệu khác" style="font-size: 11px; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
                                🎲 Đổi bài khác
                            </button>
                            <button type="button" class="btn btn-outline btn-sm btn-remedial-edit" data-qidx="${qIdx}" title="Chỉnh sửa đề bài & gợi ý theo ý Thầy/Cô" style="font-size: 11px; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
                                ✏️ Sửa đề
                            </button>
                        </div>
                    </div>
                    
                    ${rm.weakness ? `
                        <div style="font-size: 11.5px; color: #b91c1c; margin-bottom: 8px; font-weight: 600;">
                            ⚠️ Lỗ hổng cần khắc phục: ${escapeHtml(rm.weakness)}
                        </div>
                    ` : ''}

                    <div class="remedial-problem-body">
                        <strong>Đề bài rèn luyện:</strong> ${formatMathText(rm.problemLatex)}
                    </div>

                    <div class="remedial-interactive-tools">
                        <button type="button" class="btn-remedial-toggle btn-socratic-ask-inline" onclick="window.askSocraticAboutRemedial('${rm.id}')" title="Cùng Gia sư Socratic giải bài này từng bước">
                            🤖 Cùng Gia sư giải bài này
                        </button>
                        <button type="button" class="btn-remedial-toggle btn-toggle-hint" data-id="${rm.id}">
                            💡 Xem gợi ý tư duy
                        </button>
                        <button type="button" class="btn-remedial-toggle btn-toggle-sol" data-id="${rm.id}">
                            📝 Xem lời giải chi tiết
                        </button>
                    </div>

                    <div id="hint-box-${rm.id}" class="remedial-hint-box hidden">
                        <strong>💡 Gợi ý phương pháp từ Thầy Cô:</strong>
                        <div style="margin-top: 4px;">${formatMathText(rm.hint)}</div>
                    </div>

                    <div id="sol-box-${rm.id}" class="remedial-solution-box hidden">
                        <strong>📝 Lời giải chi tiết & Đáp án:</strong>
                        <div style="margin-top: 4px; white-space: pre-line;">${formatMathText(rm.solutionLatex)}</div>
                        ${rm.finalAnswer ? `<div style="margin-top: 6px; font-weight: 700; color: #166534;">🏁 Đáp số: ${renderLatexToHtml(rm.finalAnswer, false)}</div>` : ''}
                    </div>
                </div>
            `;
        });

        listContainer.innerHTML = html;
        card.classList.remove('hidden');

        // Toggle hint
        listContainer.querySelectorAll('.btn-toggle-hint').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const box = document.getElementById(`hint-box-${id}`);
                if (box) {
                    const isHidden = box.classList.contains('hidden');
                    box.classList.toggle('hidden');
                    btn.innerHTML = isHidden ? '🙈 Ẩn gợi ý' : '💡 Xem gợi ý tư duy';
                }
            });
        });

        // Toggle solution
        listContainer.querySelectorAll('.btn-toggle-sol').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const box = document.getElementById(`sol-box-${id}`);
                if (box) {
                    const isHidden = box.classList.contains('hidden');
                    box.classList.toggle('hidden');
                    btn.innerHTML = isHidden ? '🙈 Ẩn lời giải' : '📝 Xem lời giải chi tiết';
                }
            });
        });

        // Reroll remedial exercise button (AI generates new isomorphic problem)
        listContainer.querySelectorAll('.btn-remedial-reroll').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const qIdx = parseInt(btn.getAttribute('data-qidx'));
                if (!isNaN(qIdx)) {
                    window.rerollRemedial(qIdx, btn);
                }
            });
        });

        // Edit remedial exercise button (Teacher customizes problem & hints)
        listContainer.querySelectorAll('.btn-remedial-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const qIdx = parseInt(btn.getAttribute('data-qidx'));
                if (!isNaN(qIdx)) {
                    window.openEditRemedialModal(qIdx);
                }
            });
        });

        // Toggle all solutions button
        const btnToggleAll = document.getElementById('btn-toggle-all-remedial-solutions');
        if (btnToggleAll) {
            btnToggleAll.onclick = () => {
                const allBoxes = listContainer.querySelectorAll('.remedial-solution-box');
                const anyHidden = Array.from(allBoxes).some(b => b.classList.contains('hidden'));
                allBoxes.forEach(b => {
                    if (anyHidden) b.classList.remove('hidden');
                    else b.classList.add('hidden');
                });
                btnToggleAll.innerText = anyHidden ? '🙈 Ẩn tất cả lời giải' : '👁️ Hiện lời giải';
            };
        }

        // Copy remedial text button
        const btnCopyRemedial = document.getElementById('btn-copy-remedial-text');
        if (btnCopyRemedial) {
            btnCopyRemedial.onclick = async () => {
                const sName = document.getElementById('info-student-name')?.value || 'Em học sinh';
                const lTitle = document.getElementById('info-lesson-title')?.value || 'Bài kiểm tra Toán';
                let copyText = `📚 BÀI TẬP BỔ TRỢ TOÁN CÁ NHÂN HÓA DÀNH CHO: ${sName.toUpperCase()}\n`;
                copyText += `(Sau bài kiểm tra: ${lTitle})\n`;
                copyText += `----------------------------------------\n\n`;

                remedialItems.forEach((rm, idx) => {
                    copyText += `Bài ${idx + 1}: ${rm.title} (${rm.targetQuestion})\n`;
                    if (rm.weakness) copyText += `• Lỗi cần chú ý: ${rm.weakness}\n`;
                    copyText += `• Đề bài: ${rm.problemLatex}\n`;
                    copyText += `• Gợi ý phương pháp: ${rm.hint}\n\n`;
                });

                copyText += `Thầy/Cô chúc em ôn tập tốt và vững vàng kiến thức!\n`;

                try {
                    await navigator.clipboard.writeText(copyText);
                    showToast('📋 Đã sao chép nội dung bài tập bổ trợ! Bạn có thể dán (Ctrl + V) gửi phụ huynh qua Zalo.', 'success');
                } catch (e) {
                    showToast('Hãy chọn và copy nội dung bài tập bổ trợ trên màn hình.', 'info');
                }
            };
        }
    }

    // --- TỰ ĐỘNG ĐỔI BÀI TẬP BỔ TRỢ CÙNG DẠNG (ISOMORPHIC RE-ROLL) ---
    window.rerollRemedial = async function(qIdx, btnElement = null) {
        if (!currentGradingData || !currentGradingData.questions) return;
        const q = currentGradingData.questions[qIdx];
        if (!q) return;

        if (btnElement) {
            btnElement.disabled = true;
            btnElement.innerHTML = '⏳ Đang đổi...';
        }

        try {
            const firstErrStep = q.analysis ? q.analysis.find(s => s.isFirstError || s.status !== 'correct') : null;
            const payload = {
                questionId: q.questionId || q.question || String(qIdx + 1),
                problemStatementLatex: q.problemStatementLatex || '',
                classification: q.classification || {},
                errorComment: firstErrStep?.comment || q.feedback || '',
                feedback: q.feedback || '',
                difficulty: 'standard',
                currentExerciseTitle: q.customRemedialExercise?.title || q.remedialExercise?.title || '',
                referenceSolution: q.referenceSolution || {},
                methodAnchor: q.customRemedialExercise?.methodAnchor || q.remedialExercise?.methodAnchor || '',
                studentGrade: q.classification?.grade || (document.getElementById('info-student-class')?.value || '')
            };

            const res = await fetch('/api/remedial/reroll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (data.success && data.exercise) {
                q.customRemedialExercise = data.exercise;
                renderResult(currentGradingData);
                showToast(`🎲 Đã đổi sang bài toán mới tương tự cùng dạng cho Câu ${q.questionId || qIdx + 1}!`, 'success');

                // Save to IndexedDB if session active
                if (currentGradingSessionId && window.MatsudaDB) {
                    try {
                        const allH = await window.MatsudaDB.getAllHistory();
                        const target = allH.find(h => h.id === currentGradingSessionId);
                        if (target) {
                            target.gradingData = currentGradingData;
                            await window.MatsudaDB.saveHistory(target);
                        }
                    } catch (e) {
                        console.warn('Sync IndexedDB error:', e);
                    }
                }
            } else {
                showToast(data.message || 'Không thể đổi bài toán lúc này.', 'warning');
            }
        } catch (err) {
            console.error('Reroll remedial error:', err);
            showToast('Lỗi kết nối khi đổi bài tập.', 'error');
        } finally {
            if (btnElement) {
                btnElement.disabled = false;
                btnElement.innerHTML = '🎲 Đổi bài khác';
            }
        }
    };

    // --- MODAL CHỈNH SỬA BÀI TẬP BỔ TRỢ THEO Ý GIÁO VIÊN ---
    window.openEditRemedialModal = function(qIdx) {
        if (!currentGradingData || !currentGradingData.questions) return;
        const q = currentGradingData.questions[qIdx];
        if (!q) return;

        const modal = document.getElementById('remedial-edit-modal');
        if (!modal) return;

        const allRemedials = generateRemedialQuestions(currentGradingData);
        const activeEx = q.customRemedialExercise || q.remedialExercise || (allRemedials.find(r => r.questionIndex === qIdx)) || {};

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        setVal('edit-remedial-qidx', qIdx);
        setVal('edit-remedial-title', activeEx.title || `🎯 Rèn luyện kiến thức Câu ${q.questionId || qIdx + 1}`);
        setVal('edit-remedial-weakness', activeEx.weakness || '');
        setVal('edit-remedial-problem', activeEx.problemLatex || '');
        setVal('edit-remedial-hint', activeEx.hint || '');
        setVal('edit-remedial-solution', activeEx.solutionLatex || '');
        setVal('edit-remedial-final', activeEx.finalAnswer || '');

        modal.classList.remove('hidden');
    };

    const btnCloseRemedialEdit = document.getElementById('btn-close-remedial-edit');
    const btnCancelRemedialEdit = document.getElementById('btn-cancel-remedial-edit');
    const btnSaveRemedialEdit = document.getElementById('btn-save-remedial-edit');
    const remedialEditModal = document.getElementById('remedial-edit-modal');

    const closeRemedialModal = () => remedialEditModal?.classList.add('hidden');
    if (btnCloseRemedialEdit) btnCloseRemedialEdit.onclick = closeRemedialModal;
    if (btnCancelRemedialEdit) btnCancelRemedialEdit.onclick = closeRemedialModal;

    if (btnSaveRemedialEdit) {
        btnSaveRemedialEdit.onclick = async () => {
            const qIdx = parseInt(document.getElementById('edit-remedial-qidx')?.value);
            if (isNaN(qIdx) || !currentGradingData?.questions?.[qIdx]) return;

            const q = currentGradingData.questions[qIdx];
            const getVal = (id) => (document.getElementById(id)?.value || '').trim();

            q.customRemedialExercise = {
                title: getVal('edit-remedial-title') || `🎯 Rèn luyện kiến thức Câu ${q.questionId || qIdx + 1}`,
                weakness: getVal('edit-remedial-weakness'),
                problemLatex: getVal('edit-remedial-problem'),
                hint: getVal('edit-remedial-hint'),
                solutionLatex: getVal('edit-remedial-solution'),
                finalAnswer: getVal('edit-remedial-final')
            };

            closeRemedialModal();
            renderResult(currentGradingData);
            showToast('💾 Đã lưu bài tập bổ trợ tùy chỉnh!', 'success');

            if (currentGradingSessionId && window.MatsudaDB) {
                try {
                    const allH = await window.MatsudaDB.getAllHistory();
                    const target = allH.find(h => h.id === currentGradingSessionId);
                    if (target) {
                        target.gradingData = currentGradingData;
                        await window.MatsudaDB.saveHistory(target);
                    }
                } catch (e) {
                    console.warn('Sync IndexedDB error:', e);
                }
            }
        };
    }

    function renderResult(data) {
        data = sanitizeMathData(data);
        currentGradingData = data;

        // Apply student mode / reference solution visibility class
        const resultSec = document.getElementById('result-section');
        if (currentViewMode === 'student') {
            resultSec.classList.add('student-mode-active');
            if (!exportOptions.referenceSolution) {
                resultSec.classList.add('hide-reference-solution');
            } else {
                resultSec.classList.remove('hide-reference-solution');
            }
        } else {
            resultSec.classList.remove('student-mode-active');
            resultSec.classList.remove('hide-reference-solution');
        }

        // Show or hide Teacher Edited Banner
        const teacherEditedBanner = document.getElementById('teacher-edited-banner');
        if (teacherEditedBanner) {
            if (data.isTeacherEdited) {
                teacherEditedBanner.classList.remove('hidden');
            } else {
                teacherEditedBanner.classList.add('hidden');
            }
        }

        // Calculate step statistics
        let totalQuestions = 0;
        let totalSteps = 0;
        let correctSteps = 0;
        let errorSteps = 0;

        if (data.questions && data.questions.length > 0) {
            totalQuestions = data.questions.length;
            data.questions.forEach(q => {
                if (q.analysis && q.analysis.length > 0) {
                    q.analysis.forEach(s => {
                        totalSteps++;
                        if (s.status === 'correct') {
                            correctSteps++;
                        } else {
                            errorSteps++;
                        }
                    });
                }
            });
        }

        const statCorrectEl = document.getElementById('stat-correct-steps');
        const statErrorEl = document.getElementById('stat-error-steps');
        const statTotalEl = document.getElementById('stat-total-questions');
        if (statCorrectEl) statCorrectEl.innerText = correctSteps;
        if (statErrorEl) statErrorEl.innerText = errorSteps;
        if (statTotalEl) statTotalEl.innerText = totalQuestions || 1;

        // Render Circular 22 Matrix Competency Breakdown
        const matrixCard = document.getElementById('matrix-competency-card');
        if (matrixCard && data.questions && data.questions.length > 0) {
            let mNb = 0, pNb = 0;
            let mTh = 0, pTh = 0;
            let mVd = 0, pVd = 0;
            let mVdc = 0, pVdc = 0;
            data.questions.forEach(q => {
                const lvl = getQuestionLevel(q);
                const sc = q.maxScore || q.max_score || q.score || 0;
                if (lvl.key === 'nb') { mNb++; pNb += sc; }
                else if (lvl.key === 'th') { mTh++; pTh += sc; }
                else if (lvl.key === 'vd') { mVd++; pVd += sc; }
                else if (lvl.key === 'vdc') { mVdc++; pVdc += sc; }
            });

            const totalQ = data.questions.length;
            const elNb = document.getElementById('matrix-cnt-nb');
            const elTh = document.getElementById('matrix-cnt-th');
            const elVd = document.getElementById('matrix-cnt-vd');
            const elVdc = document.getElementById('matrix-cnt-vdc');
            const ptsNbEl = document.getElementById('matrix-pts-nb');
            const ptsThEl = document.getElementById('matrix-pts-th');
            const ptsVdEl = document.getElementById('matrix-pts-vd');
            const ptsVdcEl = document.getElementById('matrix-pts-vdc');
            const barNb = document.getElementById('matrix-bar-nb');
            const barTh = document.getElementById('matrix-bar-th');
            const barVd = document.getElementById('matrix-bar-vd');
            const barVdc = document.getElementById('matrix-bar-vdc');

            if (elNb) elNb.innerText = mNb;
            if (elTh) elTh.innerText = mTh;
            if (elVd) elVd.innerText = mVd;
            if (elVdc) elVdc.innerText = mVdc;
            if (ptsNbEl) ptsNbEl.innerText = pNb.toFixed(1);
            if (ptsThEl) ptsThEl.innerText = pTh.toFixed(1);
            if (ptsVdEl) ptsVdEl.innerText = pVd.toFixed(1);
            if (ptsVdcEl) ptsVdcEl.innerText = pVdc.toFixed(1);

            if (barNb) barNb.style.width = `${totalQ > 0 ? (mNb / totalQ) * 100 : 0}%`;
            if (barTh) barTh.style.width = `${totalQ > 0 ? (mTh / totalQ) * 100 : 0}%`;
            if (barVd) barVd.style.width = `${totalQ > 0 ? (mVd / totalQ) * 100 : 0}%`;
            if (barVdc) barVdc.style.width = `${totalQ > 0 ? (mVdc / totalQ) * 100 : 0}%`;

            matrixCard.classList.remove('hidden');
        } else if (matrixCard) {
            matrixCard.classList.add('hidden');
        }

        // 1. Render Score
        triggerScoreAnimation(data.score);
        
        // 2. Render Summary with math support
        resultSummary.innerHTML = formatMathText(data.summary);

        // 3. Render Questions List with 3 Layers
        questionsList.innerHTML = '';
        if (data.questions && data.questions.length > 0) {
            data.questions.forEach((q, idx) => {
                const qId = q.questionId || q.question || `${idx + 1}`;
                const qScore = q.score !== undefined ? q.score : 0;
                const qMax = q.maxScore || q.max_score || 10;
                
                let badgeClass = 'success';
                let icon = '✅';
                let resultText = q.result || (q.status === 'correct' ? 'Đúng hoàn toàn' : 'Sai');
                const lowerRes = (resultText || '').toLowerCase();
                if (lowerRes.includes('sai') || q.status === 'incorrect') {
                    badgeClass = 'danger';
                    icon = '❌';
                } else if (lowerRes.includes('thiếu') || lowerRes.includes('chưa') || q.status === 'partial') {
                    badgeClass = 'warning';
                    icon = '⚠️';
                }

                // Classification & Level tags HTML
                const lvlInfo = getQuestionLevel(q);
                const gradeStr = q.classification?.grade || 'THCS';
                const topicStr = q.classification?.topic || 'Toán';
                const subtopicStr = q.classification?.subtopic || '';
                const classBadgeHtml = `
                    <div class="q-classification-bar">
                        <span class="badge-tag level level-${lvlInfo.key}" title="Mức độ năng lực theo Thông tư 22 Bộ GD&ĐT">🎯 ${lvlInfo.label}</span>
                        <span class="badge-tag grade">📚 ${escapeHtml(gradeStr)}</span>
                        <span class="badge-tag topic">📐 ${escapeHtml(topicStr)}</span>
                        ${subtopicStr ? `<span class="badge-tag subtopic">🏷️ ${escapeHtml(subtopicStr)}</span>` : ''}
                    </div>
                `;

                // Header HTML
                let qHtml = `
                    <div class="question-item">
                        <div class="question-header">
                            <div class="q-title-row">
                                <span class="q-index-badge">Câu ${qId}</span>
                                ${classBadgeHtml}
                            </div>
                            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                                <button type="button" class="btn-socratic-ask-inline" onclick="window.askSocraticAboutQuestion(${idx})" title="Mở Gia sư Socratic để được gợi mở từng nấc cho câu này">
                                    🤖 Hỏi Gia sư Socratic
                                </button>
                                <span class="q-score">${qScore}/${qMax}</span>
                                <span class="q-badge ${badgeClass}">${icon} ${resultText}</span>
                            </div>
                        </div>
                `;

                // If problem statement exists
                if (q.problemStatementLatex) {
                    qHtml += `
                        <div style="margin-bottom: 16px; padding: 12px 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                            <span style="font-weight: 700; font-size: 13px; color: #475569; display: flex; align-items: center; gap: 6px;">📐 Đề bài:</span>
                            <div class="math-display-card" style="margin-top: 6px; background: #ffffff;">${formatMathText(q.problemStatementLatex)}</div>
                        </div>
                    `;
                }

                // Check if rich 3-layer information exists
                if (q.referenceSolution || q.analysis) {
                    qHtml += `<div class="three-layers-wrapper">`;

                    // ============================================
                    // LỚP 1: ĐÁP ÁN CHUẨN (AI TỰ GIẢI ĐỘC LẬP TỪ ĐẦU)
                    // ============================================
                    if (q.referenceSolution) {
                        qHtml += `
                            <div class="layer-section layer-reference" id="ref-solution-${idx}">
                                <div class="layer-title-header">
                                    <div>
                                        <h4 class="layer-title">📘 LỜI GIẢI MẪU CHUẨN XÁC</h4>
                                        <div class="layer-desc-subtitle">Đáp án do AI tự giải độc lập từ đầu theo chuẩn chương trình THCS</div>
                                    </div>
                                    <button type="button" class="btn btn-outline btn-sm" onclick="window.toggleRefSolution(${idx})" id="btn-toggle-ref-${idx}" style="font-size: 12px; padding: 4px 10px;">
                                        Thu gọn đáp án
                                    </button>
                                </div>
                                <div id="ref-content-body-${idx}">
                        `;

                        // If Domain Condition (ĐKXĐ) or Variable Declaration exists
                        if (q.referenceSolution.domainConditionLatex || q.referenceSolution.variableDeclaration) {
                            qHtml += `<div class="geometry-gt-kl" style="margin-bottom: 12px;">`;
                            if (q.referenceSolution.domainConditionLatex) {
                                qHtml += `<div class="gt-kl-item"><strong>Điều kiện xác định (ĐKXĐ):</strong> ${renderLatexToHtml(q.referenceSolution.domainConditionLatex, false)}</div>`;
                            }
                            if (q.referenceSolution.variableDeclaration) {
                                qHtml += `<div class="gt-kl-item"><strong>Gọi ẩn & điều kiện:</strong> ${formatMathText(q.referenceSolution.variableDeclaration)}</div>`;
                            }
                            qHtml += `</div>`;
                        }

                        // If Geometry GT/KL exists
                        if (q.referenceSolution.hypothesisLatex || q.referenceSolution.conclusionLatex) {
                            qHtml += `
                                <div class="geometry-gt-kl">
                                    ${q.referenceSolution.hypothesisLatex ? `<div class="gt-kl-item"><strong>Giả thiết (GT):</strong> ${renderLatexToHtml(q.referenceSolution.hypothesisLatex, false)}</div>` : ''}
                                    ${q.referenceSolution.conclusionLatex ? `<div class="gt-kl-item"><strong>Kết luận (KL):</strong> ${renderLatexToHtml(q.referenceSolution.conclusionLatex, false)}</div>` : ''}
                                </div>
                            `;
                        }

                        qHtml += `<div class="ref-steps-list">`;

                        if (q.referenceSolution.steps && q.referenceSolution.steps.length > 0) {
                            q.referenceSolution.steps.forEach(refStep => {
                                qHtml += `
                                    <div class="ref-step-item">
                                        <div class="ref-step-header">
                                            <span class="ref-step-num">${refStep.stepNumber}</span>
                                            <span>Bước ${refStep.stepNumber}: ${escapeHtml(refStep.explanation || refStep.solutionText || '')}</span>
                                        </div>
                                        <div class="math-display-card">
                                            ${renderLatexToHtml(refStep.solutionLatex, true)}
                                        </div>
                                    </div>
                                `;
                            });
                        }

                        if (q.referenceSolution.finalAnswerLatex) {
                            qHtml += `
                                <div class="ref-final-answer">
                                    <span class="ref-final-label">🏁 Kết luận / Đáp số chuẩn:</span>
                                    <div style="font-size: 16px; font-weight: 700;">${renderLatexToHtml(q.referenceSolution.finalAnswerLatex, false)}</div>
                                </div>
                            `;
                        }

                        qHtml += `</div></div></div>`; // Close ref-content-body and layer-reference
                    }

                    // ============================================
                    // LỚP 2: BÀI LÀM CỦA HỌC SINH (ẢNH GỐC)
                    // ============================================
                    const images = (currentGradingImages && currentGradingImages.length > 0)
                        ? currentGradingImages
                        : (selectedFileUrl ? [{ pageIndex: 0, dataUrl: selectedFileUrl }] : []);

                    if (images.length > 0) {
                        const defaultImg = images[0].dataUrl;
                        let pageTabsHtml = '';
                        if (images.length > 1) {
                            pageTabsHtml = `<div class="multi-page-tab-bar">`;
                            images.forEach((im, pIdx) => {
                                pageTabsHtml += `<button type="button" class="page-tab-btn ${pIdx === 0 ? 'active' : ''}" onclick="window.switchStudentWorkPage(${idx}, ${pIdx})">📄 Trang ${pIdx + 1}</button>`;
                            });
                            pageTabsHtml += `</div>`;
                        }

                        qHtml += `
                            <div class="layer-section layer-student-work" id="student-work-card-${idx}">
                                <div class="layer-title-header">
                                    <div>
                                        <h4 class="layer-title">📝 BÀI LÀM CỦA HỌC SINH</h4>
                                        <div class="layer-desc-subtitle">Ảnh bài làm gốc học sinh ${images.length > 1 ? `(${images.length} trang)` : ''}</div>
                                    </div>
                                    <button type="button" class="btn btn-outline" onclick="window.openLightboxForQuestion(${idx})" style="padding: 5px 12px; font-size: 12px; font-weight: 600;">🔍 Phóng to bài làm</button>
                                </div>
                                ${pageTabsHtml}
                                <div class="student-img-preview-card">
                                    <div class="student-img-thumb-wrapper" onclick="window.openLightboxForQuestion(${idx})" title="Nhấn để phóng to toàn màn hình">
                                        <img id="student-work-img-${idx}" src="${defaultImg}" alt="Ảnh bài làm gốc">
                                        <span class="thumb-overlay-hint">🔍 Nhấn để xem toàn cảnh & phóng to</span>
                                    </div>
                                </div>
                            </div>
                        `;
                    }

                    // ============================================
                    // LỚP 3: PHÂN TÍCH ĐỐI CHIẾU TỪNG BƯỚC
                    // ============================================
                    if (q.analysis && q.analysis.length > 0) {
                        qHtml += `
                            <div class="layer-section layer-analysis">
                                <div class="layer-title-header">
                                    <div>
                                        <h4 class="layer-title">🔎 PHÂN TÍCH ĐỐI CHIẾU TỪNG BƯỚC</h4>
                                        <div class="layer-desc-subtitle">Chi tiết từng bước giải của học sinh đối chiếu với đáp án chuẩn</div>
                                    </div>
                                </div>
                                <div class="analysis-steps-list">
                        `;

                        q.analysis.forEach((step, sIdx) => {
                            const isFirstErr = !!step.isFirstError;
                            const isCascading = step.status === 'cascading_error' || !!step.isFollowUpError;
                            const isIndependentErr = !!step.isIndependentError;
                            const isIncomplete = step.status === 'incomplete';
                            const isUnclear = step.status === 'unclear';
                            const isIncorrect = step.status === 'incorrect';
                            const isCorrect = step.status === 'correct';

                            const stepPageIdx = (step.pageIndex !== undefined && step.pageIndex >= 0 && step.pageIndex < images.length) ? step.pageIndex : 0;
                            const stepImgUrl = images[stepPageIdx]?.dataUrl || images[0]?.dataUrl;

                            let cardClass = 'analysis-step-item';
                            if (isFirstErr) cardClass += ' is-first-error';
                            else if (isCascading) cardClass += ' is-cascading';
                            else if (isIndependentErr) cardClass += ' is-independent-error';

                            // Badges for step
                            let badgeTag = '';
                            if (isCorrect) {
                                badgeTag = `<span class="step-badge correct">✅ Đúng bước này</span>`;
                            } else if (isIncomplete) {
                                badgeTag = `<span class="step-badge incomplete">⚠️ Chưa hoàn thiện</span>`;
                            } else if (isUnclear) {
                                badgeTag = `<span class="step-badge unclear">⚠️ Không đọc rõ</span>`;
                            } else if (isCascading) {
                                badgeTag = `<span class="step-badge cascading">🔗 LỖI KÉO THEO</span>`;
                            } else if (isIndependentErr) {
                                badgeTag = `<span class="step-badge independent-error-tag">⚡ LỖI ĐỘC LẬP</span>`;
                            } else if (isIncorrect) {
                                badgeTag = `<span class="step-badge incorrect">❌ Sai</span>`;
                            }

                            if (isFirstErr) {
                                badgeTag += `<span class="step-badge first-error-tag">🎯 LỖI ĐẦU TIÊN: Bước ${step.stepNumber}</span>`;
                            }

                            // Technical confidence badge for teacher
                            if (step.confidence !== undefined && step.confidence !== null) {
                                const confPct = Math.round(step.confidence * 100);
                                badgeTag += `<span class="step-badge technical-meta confidence-tag" style="background: #f1f5f9; color: #475569; font-weight: 600;">Độ tin cậy: ${confPct}%</span>`;
                            }

                            // Step specific guidance banners
                            let stepBannerHtml = '';
                            if (isFirstErr) {
                                stepBannerHtml = `
                                    <div class="first-error-banner">
                                        <span>🎯</span>
                                        <div><strong>LỖI ĐẦU TIÊN TẠI BƯỚC NÀY:</strong> Học sinh bắt đầu nhầm lẫn từ đây. Cần đặc biệt chú ý sửa bước này để các bước sau không bị mất điểm!</div>
                                    </div>
                                `;
                            } else if (isCascading) {
                                stepBannerHtml = `
                                    <div class="cascading-banner">
                                        <span>🔗</span>
                                        <div><strong>LỖI KÉO THEO (CASCADING):</strong> Kết quả bước này bị sai do sử dụng số liệu từ bước trước; tuy nhiên tư duy và quy tắc biến đổi của em vẫn rất đúng hướng!</div>
                                    </div>
                                `;
                            } else if (isIndependentErr) {
                                stepBannerHtml = `
                                    <div class="first-error-banner" style="background: #faf5ff; border-color: #e9d5ff; color: #6b21a8;">
                                        <span>⚡</span>
                                        <div><strong>LỖI ĐỘC LẬP MỚI:</strong> Phát sinh sai sót mới độc lập với các bước biến đổi trước.</div>
                                    </div>
                                `;
                            }

                            // Comparison Grid
                            qHtml += `
                                <div class="${cardClass}">
                                    <div class="step-card-header">
                                        <span class="step-card-title">Bước ${step.stepNumber} ${images.length > 1 ? `<span style="font-size: 11px; font-weight: 700; color: #475569; background: #e2e8f0; padding: 2px 8px; border-radius: 6px; margin-left: 6px;">Trang ${stepPageIdx + 1}</span>` : ''}</span>
                                        <div class="step-badges">${badgeTag}</div>
                                    </div>
                                    ${stepBannerHtml}
                                    
                                    <div class="step-comparison-grid">
                                        <!-- Cột 1: Đáp án chuẩn -->
                                        <div class="comp-column">
                                            <span class="comp-label">📘 Đáp án chuẩn:</span>
                                            <div class="math-display-card">
                                                ${renderLatexToHtml(step.referenceStepLatex || (q.referenceSolution && q.referenceSolution.steps && q.referenceSolution.steps[step.stepNumber - 1] ? q.referenceSolution.steps[step.stepNumber - 1].solutionLatex : ''), true)}
                                            </div>
                                        </div>

                                        <!-- Cột 2: Bài làm học sinh -->
                                        <div class="comp-column">
                                            <span class="comp-label">📝 Bài làm học sinh:</span>
                            `;

                            // BBox crop snippet if bbox exists and valid
                            if (stepImgUrl && step.bbox && step.bbox.width > 0 && step.bbox.height > 0) {
                                const bx = Math.max(0, Math.min(100, step.bbox.x));
                                const by = Math.max(0, Math.min(100, step.bbox.y));
                                const bw = Math.max(5, Math.min(100, step.bbox.width));
                                const bh = Math.max(5, Math.min(100, step.bbox.height));
                                
                                const topPct = -((by / bh) * 100);
                                const leftPct = -((bx / bw) * 100);
                                const widthPct = (100 / bw) * 100;
                                const heightPct = (100 / bh) * 100;

                                qHtml += `
                                    <div class="crop-preview-box" onclick="window.openLightbox('${stepImgUrl}')" title="Vùng cắt nét chữ trên bài làm gốc trang ${stepPageIdx + 1} (Nhấn để xem ảnh đầy đủ)">
                                        <img class="crop-preview-img" src="${stepImgUrl}" style="top: ${topPct}%; left: ${leftPct}%; width: ${widthPct}%; height: ${heightPct}%;" alt="Vùng chữ bước ${step.stepNumber}">
                                    </div>
                                `;
                            } else {
                                qHtml += `
                                    <div class="crop-fallback-box" ${stepImgUrl ? `onclick="window.openLightbox('${stepImgUrl}')" style="cursor: pointer;"` : ''}>
                                        <span>📷 Nét chữ bước này trên ảnh gốc ${images.length > 1 ? `(Trang ${stepPageIdx + 1})` : ''}</span>
                                    </div>
                                `;
                            }

                            // Student written LaTeX formula and text
                            const writtenClass = isCorrect ? 'student-written' : 'student-written has-error';
                            qHtml += `
                                            ${step.studentText ? `<div style="font-size: 12px; color: #475569; margin: 2px 0;"><strong>Học sinh ghi:</strong> ${escapeHtml(step.studentText)}</div>` : ''}
                                            <div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); margin-top: 2px;">Công thức nhận diện:</div>
                                            <div class="math-display-card ${writtenClass}">
                                                ${renderLatexToHtml(step.studentLatex, true)}
                                            </div>
                                        </div>
                                    </div>
                            `;

                            // Ngưỡng tin cậy 2 tầng: <65% không chốt tự động; 65-85% cần rà soát nhanh.
                            if (step.confidence !== undefined && step.confidence !== null && step.confidence < 0.65) {
                                qHtml += `
                                    <div class="confidence-warning-box technical-meta">
                                        <span>⛔ Độ tin cậy thấp (${Math.round(step.confidence * 100)}%). Không nên chốt điểm tự động; giáo viên cần đối chiếu ảnh gốc.</span>
                                    </div>
                                `;
                            } else if (step.confidence !== undefined && step.confidence !== null && step.confidence < 0.85) {
                                qHtml += `
                                    <div class="confidence-warning-box technical-meta">
                                        <span>⚠️ Độ tin cậy trung bình (${Math.round(step.confidence * 100)}%). Nên rà soát nhanh bước này trước khi xác nhận điểm.</span>
                                    </div>
                                `;
                            }

                            // Remarks or praise
                            if (isCorrect && !step.comment) {
                                qHtml += `
                                    <div class="step-praise-box">
                                        <span>✨</span> <div><strong>Đánh giá:</strong> Thực hiện phép biến đổi chính xác, đúng quy tắc toán học.</div>
                                    </div>
                                `;
                            } else if (step.comment) {
                                qHtml += `
                                    <div class="step-comment-box">
                                        <strong>🔍 Chi tiết nhận xét:</strong> ${formatMathText(step.comment)}
                                    </div>
                                `;
                            }

                            // Correction if present
                            if (step.correctionLatex) {
                                qHtml += `
                                    <div class="step-correction-box">
                                        <strong>💡 Hướng dẫn sửa đúng:</strong>
                                        <div style="margin-top: 4px;">${renderLatexToHtml(step.correctionLatex, false)}</div>
                                    </div>
                                `;
                            }

                            // Mục 2: Nút Hỏi Gia sư AI về bước này (tự động nạp sâu ngữ cảnh bước giải)
                            qHtml += `
                                <div class="step-socratic-action-bar">
                                    <button type="button" class="btn-socratic-step-ask ${!isCorrect ? 'has-error' : ''}" onclick="window.askSocraticAboutStep(${idx}, ${sIdx})" title="Nhờ Gia sư Socratic dẫn dắt tháo gỡ lỗi sai ở Bước ${step.stepNumber}">
                                        🤖 Hỏi Gia sư về Bước ${step.stepNumber} này
                                    </button>
                                </div>
                            `;

                            qHtml += `</div>`; // Close analysis-step-item
                        });

                        qHtml += `</div></div>`; // Close layer-analysis
                    }

                    // General Comment for this question
                    if (q.generalComment) {
                        qHtml += `
                            <div class="question-general-comment">
                                <div class="general-comment-title">📝 Đánh giá tổng hợp câu ${qId}:</div>
                                <ul class="gc-pills-list">
                        `;
                        if (q.generalComment.strengths && q.generalComment.strengths.length > 0) {
                            q.generalComment.strengths.forEach(s => {
                                qHtml += `<li class="gc-pill-item strength"><span>✓</span> <div><strong>Điểm mạnh:</strong> ${formatMathText(s)}</div></li>`;
                            });
                        }
                        if (q.generalComment.mainErrors && q.generalComment.mainErrors.length > 0) {
                            q.generalComment.mainErrors.forEach(e => {
                                qHtml += `<li class="gc-pill-item error"><span>⚠</span> <div><strong>Lỗi chính:</strong> ${formatMathText(e)}</div></li>`;
                            });
                        }
                        if (q.generalComment.knowledgeToReview && q.generalComment.knowledgeToReview.length > 0) {
                            q.generalComment.knowledgeToReview.forEach(r => {
                                qHtml += `<li class="gc-pill-item review"><span>💡</span> <div><strong>Kiến thức cần củng cố:</strong> ${formatMathText(r)}</div></li>`;
                            });
                        }
                        qHtml += `</ul></div>`;
                    }

                    qHtml += `</div>`; // Close three-layers-wrapper
                } else {
                    // Backward compatible fallback for simple questions
                    qHtml += `
                        <div class="q-feedback">
                            <strong>Nhận xét:</strong> ${formatMathText(q.feedback || '')}
                        </div>
                    `;
                }

                qHtml += `</div>`; // Close question-item
                questionsList.innerHTML += qHtml;
            });
        } else {
            questionsList.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Không phát hiện được câu hỏi cụ thể.</p>';
        }

        // 4. Render Overall Feedback
        overallFeedbackList.innerHTML = '';
        if (data.overall_feedback && data.overall_feedback.length > 0) {
            data.overall_feedback.forEach(item => {
                overallFeedbackList.innerHTML += `<li class="overall-fb-item"><span class="fb-icon">🎯</span> <div>${formatMathText(item)}</div></li>`;
            });
        }

        // Also render data.generalComment if present at root
        if (data.generalComment) {
            let gcHtml = `<div class="question-general-comment" style="margin-top: 15px;">
                <div class="general-comment-title">📊 Tổng kết kiến thức toàn bài:</div>
                <ul class="gc-pills-list">`;
            if (data.generalComment.strengths && data.generalComment.strengths.length > 0) {
                data.generalComment.strengths.forEach(s => {
                    gcHtml += `<li class="gc-pill-item strength"><span>✓</span> <div>${formatMathText(s)}</div></li>`;
                });
            }
            if (data.generalComment.mainErrors && data.generalComment.mainErrors.length > 0) {
                data.generalComment.mainErrors.forEach(e => {
                    gcHtml += `<li class="gc-pill-item error"><span>⚠</span> <div>${formatMathText(e)}</div></li>`;
                });
            }
            if (data.generalComment.knowledgeToReview && data.generalComment.knowledgeToReview.length > 0) {
                data.generalComment.knowledgeToReview.forEach(r => {
                    gcHtml += `<li class="gc-pill-item review"><span>💡</span> <div><strong>Củng cố:</strong> ${formatMathText(r)}</div></li>`;
                });
            }
            gcHtml += `</ul></div>`;
            overallFeedbackList.innerHTML += gcHtml;
        }

        // 5. Render Bài Tập Bổ Trợ Cá Nhân Hóa Theo Lỗi Sai (Mục 2)
        renderRemedialPracticeCard(data);

        // Trigger Auto-render KaTeX if available
        if (window.renderMathInElement) {
            try {
                window.renderMathInElement(document.getElementById('result-section'), {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '\\[', right: '\\]', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false}
                    ],
                    throwOnError: false
                });
            } catch (err) {
                console.warn('Auto-render error:', err);
            }
        }

        // Khởi tạo công cụ Bút đỏ giáo viên
        setupRedPenWrapperListeners();
        updateRedPenUI();
    }

    // ========================================================
    // MỤC 3: CÔNG CỤ BÚT ĐỎ GIÁO VIÊN & GHI CHÚ TRỰC TIẾP TRÊN ẢNH
    // ========================================================
    const btnToggleRedPen = document.getElementById('btn-toggle-red-pen');
    let isRedPenActive = false;
    let currentRedPenTool = 'correct'; // 'correct', 'wrong', 'circle', 'comment'

    function updateRedPenUI() {
        if (btnToggleRedPen) {
            btnToggleRedPen.classList.toggle('active', isRedPenActive);
            btnToggleRedPen.style.background = isRedPenActive ? '#fef2f2' : '';
            btnToggleRedPen.style.color = isRedPenActive ? '#dc2626' : '';
            btnToggleRedPen.style.borderColor = isRedPenActive ? '#f87171' : '';
            btnToggleRedPen.innerHTML = isRedPenActive ? '🖍️ Đang bật Bút đỏ' : '🖍️ Bút đỏ sửa bài';
        }

        document.querySelectorAll('.student-img-thumb-wrapper').forEach(wrapper => {
            wrapper.style.cursor = isRedPenActive ? 'crosshair' : 'pointer';
            
            let toolBar = wrapper.parentElement.querySelector('.red-pen-toolbar-container');
            if (isRedPenActive) {
                if (!toolBar) {
                    toolBar = document.createElement('div');
                    toolBar.className = 'red-pen-toolbar-container';
                    toolBar.innerHTML = `
                        <span style="font-size: 11px; font-weight: 800; color: #b91c1c;">🖍️ Chọn bút:</span>
                        <button type="button" class="btn-pen-tool ${currentRedPenTool === 'correct' ? 'active' : ''}" data-tool="correct">✓ Đúng</button>
                        <button type="button" class="btn-pen-tool ${currentRedPenTool === 'wrong' ? 'active' : ''}" data-tool="wrong">✗ Sai</button>
                        <button type="button" class="btn-pen-tool ${currentRedPenTool === 'circle' ? 'active' : ''}" data-tool="circle">⭕ Khoanh lỗi</button>
                        <button type="button" class="btn-pen-tool ${currentRedPenTool === 'comment' ? 'active' : ''}" data-tool="comment">💬 Lời phê</button>
                        <button type="button" class="btn-pen-tool btn-clear-stamps" style="color: #dc2626; margin-left: auto;">🧹 Xóa hết dấu</button>
                    `;
                    wrapper.parentElement.insertBefore(toolBar, wrapper);

                    toolBar.querySelectorAll('.btn-pen-tool[data-tool]').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            currentRedPenTool = btn.getAttribute('data-tool');
                            toolBar.querySelectorAll('.btn-pen-tool[data-tool]').forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                        });
                    });

                    toolBar.querySelector('.btn-clear-stamps')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        wrapper.querySelectorAll('.teacher-annotation-stamp').forEach(st => st.remove());
                        showToast('Đã xóa tất cả dấu bút đỏ trên ảnh này.', 'info');
                    });
                } else {
                    toolBar.classList.remove('hidden');
                }
            } else {
                if (toolBar) toolBar.classList.add('hidden');
            }
        });
    }

    function setupRedPenWrapperListeners() {
        document.querySelectorAll('.student-img-thumb-wrapper').forEach(wrapper => {
            if (wrapper.dataset.redPenInitialized) return;
            wrapper.dataset.redPenInitialized = 'true';

            wrapper.addEventListener('click', (e) => {
                if (!isRedPenActive) return;
                if (e.target.closest('.teacher-annotation-stamp')) {
                    e.stopPropagation();
                    e.target.closest('.teacher-annotation-stamp').remove();
                    return;
                }

                e.stopPropagation();
                const rect = wrapper.getBoundingClientRect();
                const pctX = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                const pctY = Math.round(((e.clientY - rect.top) / rect.height) * 100);

                const stamp = document.createElement('div');
                stamp.className = 'teacher-annotation-stamp';
                stamp.style.left = `${pctX}%`;
                stamp.style.top = `${pctY}%`;

                if (currentRedPenTool === 'correct') {
                    stamp.classList.add('stamp-correct');
                    stamp.innerText = '✓ Đúng';
                } else if (currentRedPenTool === 'wrong') {
                    stamp.classList.add('stamp-wrong');
                    stamp.innerText = '✗ Sai';
                } else if (currentRedPenTool === 'circle') {
                    stamp.classList.add('stamp-circle');
                    stamp.innerText = '!';
                } else if (currentRedPenTool === 'comment') {
                    const text = prompt('Nhập lời phê / ghi chú của giáo viên:', 'Nhầm dấu âm!');
                    if (!text) return;
                    stamp.classList.add('stamp-comment');
                    stamp.innerText = `💬 ${text}`;
                }

                stamp.title = 'Nhấp vào dấu này để xóa';
                stamp.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    stamp.remove();
                });

                wrapper.appendChild(stamp);
            });
        });
    }

    if (btnToggleRedPen) {
        btnToggleRedPen.addEventListener('click', () => {
            isRedPenActive = !isRedPenActive;
            updateRedPenUI();
            if (isRedPenActive) {
                showToast('🖍️ Đã bật Bút đỏ sửa bài! Thầy/cô nhấp trực tiếp vào ảnh bài làm để khoanh tròn hoặc đóng dấu nhận xét.', 'info');
            } else {
                showToast('Đã tắt chế độ Bút đỏ.', 'info');
            }
        });
    }

    // ========================================================
    // MỤC 4: TRUNG TÂM SOẠN TIN NHẮN ZALO BÁO ĐIỂM CHO PHỤ HUYNH
    // ========================================================
    let currentZaloStudent = null;
    let currentZaloTone = 'encouraging';

    function generateZaloMessage(student, tone = 'encouraging') {
        if (!student) return '';
        const name = student.name || document.getElementById('info-student-name')?.value || 'Em học sinh';
        const className = student.className || document.getElementById('info-student-class')?.value || '8A';
        const lessonTitle = student.lessonTitle || document.getElementById('info-lesson-title')?.value || 'Bài kiểm tra Toán';
        const date = student.date || document.getElementById('info-grading-date')?.value || new Date().toLocaleDateString('vi-VN');
        const scoreVal = student.score !== null && student.score !== undefined ? student.score : 0;
        const tier = getScoreTier(scoreVal);
        const data = student.gradingData || currentGradingData;

        let goodPoints = [];
        let reviewPoints = [];
        let questionsDetail = [];
        let errorsDetail = [];

        if (data?.generalComment?.strengths?.length > 0) {
            goodPoints = data.generalComment.strengths.slice(0, 3);
        }
        if (data?.generalComment?.knowledgeToReview?.length > 0) {
            reviewPoints = data.generalComment.knowledgeToReview.slice(0, 3);
        }
        if (data?.generalComment?.mainErrors?.length > 0) {
            errorsDetail = data.generalComment.mainErrors.slice(0, 3);
        }

        if (data?.questions && data.questions.length > 0) {
            data.questions.forEach((q, idx) => {
                const qId = q.questionId || q.question || `Câu ${idx + 1}`;
                const s = q.score !== undefined ? q.score : 0;
                const m = q.maxScore || q.max_score || 10;
                const isCor = q.status === 'correct' || s === m;
                questionsDetail.push(`• ${qId}: ${s}/${m}đ (${isCor ? 'Đúng' : 'Có lỗi sai'})`);
                if (!isCor && q.feedback && errorsDetail.length < 3) {
                    errorsDetail.push(`${qId}: ${q.feedback}`);
                }
            });
        }

        if (goodPoints.length === 0) {
            goodPoints.push('Con có ý thức làm bài nghiêm túc, trình bày sạch sẽ.');
        }
        if (reviewPoints.length === 0) {
            if (scoreVal >= 9) {
                reviewPoints.push('Tiếp tục phát huy và thử sức thêm các bài toán mở rộng tư duy.');
            } else {
                reviewPoints.push('Cần rèn luyện thêm kỹ năng tính toán cẩn thận và kiểm tra lại kết quả trước khi nộp.');
            }
        }

        if (tone === 'concise') {
            let msg = `📢 [BÁO ĐIỂM TOÁN] Kính gửi Quý Phụ huynh em ${name} (Lớp ${className}):\n`;
            msg += `• Bài kiểm tra: ${lessonTitle}\n`;
            msg += `• Điểm số: ${scoreVal.toFixed(1)}/10 (Xếp loại: ${tier.badge})\n`;
            if (goodPoints.length > 0) msg += `• Ưu điểm: ${goodPoints[0]}\n`;
            if (reviewPoints.length > 0) msg += `• Điểm cần ôn thêm: ${reviewPoints[0]}\n`;
            msg += `👉 Thầy/Cô gửi kèm ảnh phiếu chấm chi tiết bài làm của con. Nhờ phụ huynh xem qua và động viên con giúp Thầy/Cô nhé!`;
            return msg;
        }

        if (tone === 'detailed') {
            let msg = `Kính gửi Quý Phụ huynh em ${name} (Lớp ${className}),\n\n`;
            msg += `Thầy/Cô xin gửi thông báo kết quả chi tiết bài kiểm tra môn Toán của con:\n`;
            msg += `📋 Bài làm: ${lessonTitle} (Ngày chấm: ${date})\n`;
            msg += `🎯 Điểm tổng: ${scoreVal.toFixed(1)}/10 - Xếp loại: ${tier.badge}\n\n`;
            
            if (questionsDetail.length > 0) {
                msg += `📊 Điểm số từng câu:\n${questionsDetail.join('\n')}\n\n`;
            }

            if (errorsDetail.length > 0) {
                msg += `⚠️ Lỗi sai con cần rút kinh nghiệm:\n${errorsDetail.map(e => `• ${e}`).join('\n')}\n\n`;
            }

            const remedials = generateRemedialQuestions(data);
            if (remedials && remedials.length > 0) {
                msg += `🎯 BÀI TẬP BỔ TRỢ RÈN LUYỆN TẠI NHÀ CHO CON:\n`;
                remedials.forEach((rm, rIdx) => {
                    msg += `[Bài ${rIdx + 1}] ${rm.title}\n`;
                    msg += `Đề bài: ${rm.problemLatex}\n`;
                    if (rm.hint) msg += `Gợi ý: ${rm.hint}\n`;
                });
                msg += `\nKính nhờ Phụ huynh nhắc con làm bài tập trên vào vở để khắc phục ngay điểm yếu.\n\n`;
            }

            msg += `Trân trọng cảm ơn Quý Phụ huynh đã luôn đồng hành cùng con!\nGiáo viên bộ môn Toán`;
            return msg;
        }

        // Tone 'encouraging' (Mặc định)
        let msg = `Kính gửi Quý Phụ huynh em ${name} (Lớp ${className}),\n\n`;
        msg += `Thầy/Cô gửi phụ huynh kết quả bài kiểm tra môn Toán của con:\n`;
        msg += `📝 Bài kiểm tra: ${lessonTitle}\n`;
        msg += `🎯 Điểm số: ${scoreVal.toFixed(1)}/10 (Xếp loại: ${tier.badge})\n\n`;
        
        msg += `🌟 Những điểm con làm rất tốt:\n`;
        goodPoints.forEach(p => { msg += `• ${p}\n`; });
        msg += `\n`;

        msg += `💡 Điểm con cần lưu ý rèn luyện thêm:\n`;
        reviewPoints.forEach(r => { msg += `• ${r}\n`; });
        msg += `\n`;

        msg += `Thầy/Cô rất ghi nhận sự cố gắng và nỗ lực học tập của con. Kính mong Quý Phụ huynh tiếp tục động viên và đồng hành để con ngày càng tự tin và tiến bộ hơn trong môn Toán.\n\n`;
        msg += `Thầy/Cô gửi kèm ảnh phiếu chấm chi tiết bài làm của con.\nTrân trọng,\nGiáo viên bộ môn Toán`;
        return msg;
    }

    function openZaloModalForStudent(student) {
        currentZaloStudent = student;
        const modal = document.getElementById('zalo-message-modal');
        const textarea = document.getElementById('zalo-message-textarea');
        const charCount = document.getElementById('zalo-char-count');
        if (!modal || !textarea) return;

        currentZaloTone = 'encouraging';
        document.querySelectorAll('.btn-zalo-tone').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tone') === 'encouraging');
        });

        const msg = generateZaloMessage(student, currentZaloTone);
        textarea.value = msg;
        if (charCount) charCount.innerText = `${msg.length} ký tự`;

        modal.classList.remove('hidden');
    }

    function openZaloModalForCurrentGrading() {
        const s = {
            name: document.getElementById('info-student-name')?.value || 'Em học sinh',
            className: document.getElementById('info-student-class')?.value || '8A',
            lessonTitle: document.getElementById('info-lesson-title')?.value || 'Bài kiểm tra Toán',
            date: document.getElementById('info-grading-date')?.value || new Date().toLocaleDateString('vi-VN'),
            score: (currentGradingData && currentGradingData.score !== undefined) ? currentGradingData.score : 10,
            gradingData: currentGradingData
        };
        openZaloModalForStudent(s);
    }

    const btnOpenZaloModal = document.getElementById('btn-open-zalo-modal');
    if (btnOpenZaloModal) {
        btnOpenZaloModal.addEventListener('click', openZaloModalForCurrentGrading);
    }

    // Zalo tones switch
    document.querySelectorAll('.btn-zalo-tone').forEach(btn => {
        btn.addEventListener('click', () => {
            const tone = btn.getAttribute('data-tone');
            currentZaloTone = tone;
            document.querySelectorAll('.btn-zalo-tone').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const textarea = document.getElementById('zalo-message-textarea');
            const charCount = document.getElementById('zalo-char-count');
            if (textarea && currentZaloStudent) {
                const msg = generateZaloMessage(currentZaloStudent, tone);
                textarea.value = msg;
                if (charCount) charCount.innerText = `${msg.length} ký tự`;
            }
        });
    });

    // Zalo copy button
    const btnCopyZaloText = document.getElementById('btn-copy-zalo-text');
    if (btnCopyZaloText) {
        btnCopyZaloText.addEventListener('click', async () => {
            const textarea = document.getElementById('zalo-message-textarea');
            if (!textarea) return;
            const text = textarea.value.trim();
            if (!text) {
                showToast('Nội dung tin nhắn trống.', 'warning');
                return;
            }
            try {
                await navigator.clipboard.writeText(text);
                const name = currentZaloStudent?.name || 'học sinh';
                showToast(`📋 Đã sao chép tin nhắn Zalo gửi phụ huynh em ${name}! Thầy/cô chỉ cần dán (Ctrl + V) vào Zalo.`, 'success');
            } catch (err) {
                showToast('Hãy chọn toàn bộ văn bản trong khung và bấm Ctrl + C để sao chép.', 'info');
            }
        });
    }

    // Zalo textarea input count
    const zaloTextarea = document.getElementById('zalo-message-textarea');
    if (zaloTextarea) {
        zaloTextarea.addEventListener('input', () => {
            const charCount = document.getElementById('zalo-char-count');
            if (charCount) charCount.innerText = `${zaloTextarea.value.length} ký tự`;
        });
    }

    // Zalo modal close handlers
    const btnCloseZaloModal = document.getElementById('btn-close-zalo-modal');
    const btnCancelZalo = document.getElementById('btn-cancel-zalo');
    if (btnCloseZaloModal) btnCloseZaloModal.onclick = () => document.getElementById('zalo-message-modal')?.classList.add('hidden');
    if (btnCancelZalo) btnCancelZalo.onclick = () => document.getElementById('zalo-message-modal')?.classList.add('hidden');

    // --- MODE SWITCHER (TEACHER / STUDENT MODE) ---
    const btnModeTeacher = document.getElementById('btn-mode-teacher');
    const btnModeStudent = document.getElementById('btn-mode-student');

    if (btnModeTeacher && btnModeStudent) {
        btnModeTeacher.addEventListener('click', () => {
            currentViewMode = 'teacher';
            btnModeTeacher.classList.add('active');
            btnModeStudent.classList.remove('active');
            if (currentGradingData) renderResult(currentGradingData);
        });

        btnModeStudent.addEventListener('click', () => {
            currentViewMode = 'student';
            btnModeStudent.classList.add('active');
            btnModeTeacher.classList.remove('active');
            if (currentGradingData) renderResult(currentGradingData);
        });
    }

    // --- TEACHER EDIT MODAL CONTROLLER ---
    const teacherEditModal = document.getElementById('teacher-edit-modal');
    const btnOpenEdit = document.getElementById('btn-open-edit');
    const btnCloseEditModal = document.getElementById('btn-close-edit-modal');
    const btnCancelEdit = document.getElementById('btn-cancel-edit');
    const btnSaveEdit = document.getElementById('btn-save-edit');
    const editTotalScore = document.getElementById('edit-total-score');
    const editSummary = document.getElementById('edit-summary');
    const editQuestionsList = document.getElementById('edit-questions-list');
    const editStrengths = document.getElementById('edit-strengths');
    const editMainErrors = document.getElementById('edit-main-errors');
    const editKnowledgeReview = document.getElementById('edit-knowledge-review');

    if (btnOpenEdit && teacherEditModal) {
        btnOpenEdit.addEventListener('click', () => {
            if (!currentGradingData) return;

            editTotalScore.value = currentGradingData.score !== undefined ? currentGradingData.score : 0;
            editSummary.value = currentGradingData.summary || '';

            // Populate Questions and Steps
            editQuestionsList.innerHTML = '';
            if (currentGradingData.questions && currentGradingData.questions.length > 0) {
                currentGradingData.questions.forEach((q, idx) => {
                    const qId = q.questionId || q.question || `${idx + 1}`;
                    const score = q.score !== undefined ? q.score : 0;
                    const maxScore = q.maxScore || q.max_score || 10;
                    const status = q.status || (q.result === 'Đúng' ? 'correct' : 'incorrect');
                    const feedback = q.feedback || '';

                    let stepsHtml = '';
                    if (q.analysis && q.analysis.length > 0) {
                        stepsHtml = `
                            <div class="edit-steps-container">
                                <span style="font-size: 11px; font-weight: 700; color: #475569;">Chỉnh sửa từng bước giải của học sinh:</span>
                                ${q.analysis.map((step, sIdx) => {
                                    const stStatus = step.status || 'correct';
                                    const isFirst = !!step.isFirstError;
                                    const isCasc = stStatus === 'cascading_error' || !!step.isFollowUpError;
                                    const isIndep = !!step.isIndependentError;
                                    let selectVal = stStatus;
                                    if (isCasc) selectVal = 'cascading_error';
                                    else if (isIndep) selectVal = 'independent_error';

                                    return `
                                        <div class="edit-step-card">
                                            <div class="edit-step-row">
                                                <span class="edit-step-title">Bước ${step.stepNumber}:</span>
                                                <select class="form-input-sm edit-step-status" data-qidx="${idx}" data-sidx="${sIdx}" style="width: 150px; font-size: 12px; padding: 4px 8px;">
                                                    <option value="correct" ${selectVal === 'correct' ? 'selected' : ''}>✅ Đúng</option>
                                                    <option value="incorrect" ${selectVal === 'incorrect' ? 'selected' : ''}>❌ Sai</option>
                                                    <option value="cascading_error" ${selectVal === 'cascading_error' ? 'selected' : ''}>⚠️ Lỗi kéo theo</option>
                                                    <option value="independent_error" ${selectVal === 'independent_error' ? 'selected' : ''}>❌ Lỗi độc lập</option>
                                                    <option value="incomplete" ${selectVal === 'incomplete' ? 'selected' : ''}>⚠️ Chưa hoàn thiện</option>
                                                </select>
                                                <label style="font-size: 11px; font-weight: 600; color: #b91c1c; display: flex; align-items: center; gap: 4px; cursor: pointer;">
                                                    <input type="checkbox" class="edit-step-first-err" data-qidx="${idx}" data-sidx="${sIdx}" ${isFirst ? 'checked' : ''}> ❌ Lỗi đầu tiên
                                                </label>
                                            </div>
                                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                                <input type="text" class="form-input-sm edit-step-comment" data-qidx="${idx}" data-sidx="${sIdx}" value="${escapeHtml(step.comment || '')}" placeholder="Nhận xét bước này..." style="font-size: 12px;">
                                                <input type="text" class="form-input-sm edit-step-correction" data-qidx="${idx}" data-sidx="${sIdx}" value="${escapeHtml(step.correctionLatex || '')}" placeholder="Cách sửa (LaTeX)..." style="font-size: 12px;">
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `;
                    }

                    const qItem = document.createElement('div');
                    qItem.className = 'edit-q-card';
                    qItem.innerHTML = `
                        <div class="edit-q-header">
                            <span>Câu ${qId} (Tối đa ${maxScore} điểm)</span>
                        </div>
                        <div class="edit-q-controls">
                            <div>
                                <label style="font-size: 11px; font-weight: 600; color: #475569; display: block;">Điểm đạt:</label>
                                <input type="number" class="form-input-sm edit-q-score" data-idx="${idx}" min="0" max="${maxScore}" step="0.25" value="${score}">
                            </div>
                            <div>
                                <label style="font-size: 11px; font-weight: 600; color: #475569; display: block;">Trạng thái:</label>
                                <select class="form-input-sm edit-q-status" data-idx="${idx}">
                                    <option value="correct" ${status === 'correct' ? 'selected' : ''}>✅ Đúng</option>
                                    <option value="partial" ${status === 'partial' ? 'selected' : ''}>⚠ Chưa hoàn thiện</option>
                                    <option value="incorrect" ${status === 'incorrect' ? 'selected' : ''}>❌ Sai</option>
                                </select>
                            </div>
                            <div>
                                <label style="font-size: 11px; font-weight: 600; color: #475569; display: block;">Nhận xét câu:</label>
                                <input type="text" class="form-input-sm edit-q-feedback" data-idx="${idx}" value="${escapeHtml(feedback)}" placeholder="Lời phê cho câu này...">
                            </div>
                        </div>
                        ${stepsHtml}
                    `;
                    editQuestionsList.appendChild(qItem);
                });
            }

            // General comment inputs
            const gc = currentGradingData.generalComment || {};
            editStrengths.value = (gc.strengths || []).join('\n');
            editMainErrors.value = (gc.mainErrors || []).join('\n');
            editKnowledgeReview.value = (gc.knowledgeToReview || []).join('\n');

            teacherEditModal.classList.remove('hidden');
        });

        const closeEditModal = () => teacherEditModal.classList.add('hidden');
        if (btnCloseEditModal) btnCloseEditModal.addEventListener('click', closeEditModal);
        if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);

        if (btnSaveEdit) {
            btnSaveEdit.addEventListener('click', async () => {
                if (!currentGradingData) return;

                // Update total score & summary
                currentGradingData.score = parseFloat(editTotalScore.value) || 0;
                currentGradingData.summary = editSummary.value.trim();

                // Mark teacher edit flags
                currentGradingData.isTeacherEdited = true;
                currentGradingData.teacherEditedAt = new Date().toISOString();

                // Update questions
                const scoreInputs = editQuestionsList.querySelectorAll('.edit-q-score');
                const statusSelects = editQuestionsList.querySelectorAll('.edit-q-status');
                const feedbackInputs = editQuestionsList.querySelectorAll('.edit-q-feedback');

                scoreInputs.forEach(input => {
                    const idx = parseInt(input.getAttribute('data-idx'));
                    if (currentGradingData.questions[idx]) {
                        currentGradingData.questions[idx].score = parseFloat(input.value) || 0;
                    }
                });

                statusSelects.forEach(select => {
                    const idx = parseInt(select.getAttribute('data-idx'));
                    if (currentGradingData.questions[idx]) {
                        const val = select.value;
                        currentGradingData.questions[idx].status = val;
                        currentGradingData.questions[idx].result = val === 'correct' ? 'Đúng' : (val === 'incorrect' ? 'Sai' : 'Chưa hoàn thiện');
                    }
                });

                feedbackInputs.forEach(input => {
                    const idx = parseInt(input.getAttribute('data-idx'));
                    if (currentGradingData.questions[idx]) {
                        currentGradingData.questions[idx].feedback = input.value.trim();
                    }
                });

                // Update steps
                const stepStatusSelects = editQuestionsList.querySelectorAll('.edit-step-status');
                const stepFirstErrBoxes = editQuestionsList.querySelectorAll('.edit-step-first-err');
                const stepCommentInputs = editQuestionsList.querySelectorAll('.edit-step-comment');
                const stepCorrInputs = editQuestionsList.querySelectorAll('.edit-step-correction');

                stepStatusSelects.forEach(sel => {
                    const qIdx = parseInt(sel.getAttribute('data-qidx'));
                    const sIdx = parseInt(sel.getAttribute('data-sidx'));
                    const step = currentGradingData.questions[qIdx]?.analysis?.[sIdx];
                    if (step) {
                        const val = sel.value;
                        step.status = val;
                        step.isFollowUpError = (val === 'cascading_error');
                        step.isIndependentError = (val === 'independent_error');
                    }
                });

                stepFirstErrBoxes.forEach(chk => {
                    const qIdx = parseInt(chk.getAttribute('data-qidx'));
                    const sIdx = parseInt(chk.getAttribute('data-sidx'));
                    const step = currentGradingData.questions[qIdx]?.analysis?.[sIdx];
                    if (step) {
                        step.isFirstError = chk.checked;
                    }
                });

                stepCommentInputs.forEach(inp => {
                    const qIdx = parseInt(inp.getAttribute('data-qidx'));
                    const sIdx = parseInt(inp.getAttribute('data-sidx'));
                    const step = currentGradingData.questions[qIdx]?.analysis?.[sIdx];
                    if (step) {
                        step.comment = inp.value.trim();
                    }
                });

                stepCorrInputs.forEach(inp => {
                    const qIdx = parseInt(inp.getAttribute('data-qidx'));
                    const sIdx = parseInt(inp.getAttribute('data-sidx'));
                    const step = currentGradingData.questions[qIdx]?.analysis?.[sIdx];
                    if (step) {
                        step.correctionLatex = inp.value.trim();
                    }
                });

                // Update general comments
                const parseLines = (text) => text.split('\n').map(s => s.trim()).filter(Boolean);
                currentGradingData.generalComment = {
                    strengths: parseLines(editStrengths.value),
                    mainErrors: parseLines(editMainErrors.value),
                    knowledgeToReview: parseLines(editKnowledgeReview.value)
                };

                // Sync with IndexedDB if this session is saved
                if (currentGradingSessionId) {
                    try {
                        const allHistory = await MatsudaDB.getAllHistory();
                        const target = allHistory.find(h => h.id === currentGradingSessionId);
                        if (target) {
                            target.score = currentGradingData.score;
                            target.result = currentGradingData.result || (currentGradingData.score >= 5 ? 'Đạt' : 'Chưa đạt');
                            target.isTeacherEdited = true;
                            target.gradingData = currentGradingData;
                            await MatsudaDB.saveHistory(target);
                            await updateHistoryBadge();
                        }
                    } catch (err) {
                        console.warn('Sync IndexedDB on teacher edit error:', err);
                    }
                }

                closeEditModal();
                renderResult(currentGradingData);
            });
        }
    }

    // --- EXPORT OPTIONS MODAL CONTROLLER ---
    const exportOptionsModal = document.getElementById('export-options-modal');
    const btnOpenOptions = document.getElementById('btn-open-options');
    const btnCloseOptions = document.getElementById('btn-close-options');
    const btnSaveOptions = document.getElementById('btn-save-options');

    const optTotalScore = document.getElementById('opt-total-score');
    const optQuestionScores = document.getElementById('opt-question-scores');
    const optStudentImg = document.getElementById('opt-student-img');
    const optStepAnalysis = document.getElementById('opt-step-analysis');
    const optFirstError = document.getElementById('opt-first-error');
    const optCorrections = document.getElementById('opt-corrections');
    const optOverallFeedback = document.getElementById('opt-overall-feedback');
    const optReferenceSolution = document.getElementById('opt-reference-solution');
    const optRemedialExercises = document.getElementById('opt-remedial-exercises');

    if (btnOpenOptions && exportOptionsModal) {
        btnOpenOptions.addEventListener('click', () => {
            optTotalScore.checked = exportOptions.totalScore;
            optQuestionScores.checked = exportOptions.questionScores;
            optStudentImg.checked = exportOptions.studentImg;
            optStepAnalysis.checked = exportOptions.stepAnalysis;
            optFirstError.checked = exportOptions.firstError;
            optCorrections.checked = exportOptions.corrections;
            optOverallFeedback.checked = exportOptions.overallFeedback;
            optReferenceSolution.checked = exportOptions.referenceSolution;
            if (optRemedialExercises) optRemedialExercises.checked = exportOptions.remedialExercises;
            exportOptionsModal.classList.remove('hidden');
        });

        const closeOptModal = () => exportOptionsModal.classList.add('hidden');
        if (btnCloseOptions) btnCloseOptions.addEventListener('click', closeOptModal);

        if (btnSaveOptions) {
            btnSaveOptions.addEventListener('click', () => {
                exportOptions.totalScore = optTotalScore.checked;
                exportOptions.questionScores = optQuestionScores.checked;
                exportOptions.studentImg = optStudentImg.checked;
                exportOptions.stepAnalysis = optStepAnalysis.checked;
                exportOptions.firstError = optFirstError.checked;
                exportOptions.corrections = optCorrections.checked;
                exportOptions.overallFeedback = optOverallFeedback.checked;
                exportOptions.referenceSolution = optReferenceSolution.checked;
                if (optRemedialExercises) exportOptions.remedialExercises = optRemedialExercises.checked;

                closeOptModal();
                if (currentGradingData) renderResult(currentGradingData);
            });
        }
    }

    // Helper for score tiers
    function getScoreTier(score) {
        const s = Number(score) || 0;
        if (s >= 9.0) return { label: 'XUẤT SẮC', badge: '🏆 Xuất sắc', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' };
        if (s >= 8.0) return { label: 'GIỎI', badge: '🌟 Giỏi', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' };
        if (s >= 6.5) return { label: 'KHÁ', badge: '👍 Khá', color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' };
        if (s >= 5.0) return { label: 'ĐẠT', badge: '⚡ Đạt yêu cầu', color: '#d97706', bg: '#fffbeb', border: '#fde68a' };
        return { label: 'CẦN CỐ GẮNG', badge: '⚠️ Cần rèn luyện thêm', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' };
    }

    // ========================================================
    // SCHOOL & TEACHER BRANDING SUITE (TÊN TRƯỜNG & THẦY CÔ)
    // ========================================================
    const DEFAULT_BRANDING = {
        schoolName: 'Trường THCS LC',
        teacherName: 'Gv phụ trách 0775172026',
        department: 'Tổ Toán - Tin học',
        academicYear: 'Năm học 2025 - 2026',
        slogan: 'Tư duy logic • Vững bước tương lai',
        showStamp: true
    };

    function getBranding() {
        try {
            const raw = localStorage.getItem('MATSUDA_SCHOOL_BRANDING');
            if (raw) {
                const parsed = JSON.parse(raw);
                // Tự động nâng cấp nếu còn lưu giá trị mặc định cũ (Giảng Võ / Thầy Trần Matsuda)
                if (!parsed.schoolName || parsed.schoolName.includes('Giảng Võ')) {
                    parsed.schoolName = DEFAULT_BRANDING.schoolName;
                }
                if (!parsed.teacherName || parsed.teacherName.includes('Trần Matsuda')) {
                    parsed.teacherName = DEFAULT_BRANDING.teacherName;
                }
                return { ...DEFAULT_BRANDING, ...parsed };
            }
        } catch (_) {}
        return { ...DEFAULT_BRANDING };
    }

    function saveBranding(data) {
        try {
            localStorage.setItem('MATSUDA_SCHOOL_BRANDING', JSON.stringify(data));
        } catch (_) {}
    }

    const btnOpenBranding = document.getElementById('btn-open-branding');
    const brandingModal = document.getElementById('branding-modal');
    const btnCloseBranding = document.getElementById('btn-close-branding');
    const btnResetBranding = document.getElementById('btn-reset-branding');
    const btnSaveBranding = document.getElementById('btn-save-branding');

    const inputBrandingSchool = document.getElementById('branding-school-name');
    const inputBrandingTeacher = document.getElementById('branding-teacher-name');
    const inputBrandingDept = document.getElementById('branding-department');
    const inputBrandingYear = document.getElementById('branding-academic-year');
    const inputBrandingSlogan = document.getElementById('branding-slogan');
    const inputBrandingStamp = document.getElementById('branding-show-stamp');

    function populateBrandingInputs() {
        const b = getBranding();
        if (inputBrandingSchool) inputBrandingSchool.value = b.schoolName;
        if (inputBrandingTeacher) inputBrandingTeacher.value = b.teacherName;
        if (inputBrandingDept) inputBrandingDept.value = b.department;
        if (inputBrandingYear) inputBrandingYear.value = b.academicYear;
        if (inputBrandingSlogan) inputBrandingSlogan.value = b.slogan;
        if (inputBrandingStamp) inputBrandingStamp.checked = !!b.showStamp;
    }

    if (btnOpenBranding && brandingModal) {
        btnOpenBranding.addEventListener('click', () => {
            populateBrandingInputs();
            brandingModal.classList.remove('hidden');
        });
    }

    if (btnCloseBranding && brandingModal) {
        btnCloseBranding.addEventListener('click', () => {
            brandingModal.classList.add('hidden');
        });
    }

    if (btnResetBranding) {
        btnResetBranding.addEventListener('click', () => {
            saveBranding(DEFAULT_BRANDING);
            populateBrandingInputs();
            showToast('Đã khôi phục cài đặt trường học về mặc định.', 'info');
        });
    }

    if (btnSaveBranding) {
        btnSaveBranding.addEventListener('click', () => {
            const updated = {
                schoolName: inputBrandingSchool?.value.trim() || DEFAULT_BRANDING.schoolName,
                teacherName: inputBrandingTeacher?.value.trim() || DEFAULT_BRANDING.teacherName,
                department: inputBrandingDept?.value.trim() || DEFAULT_BRANDING.department,
                academicYear: inputBrandingYear?.value.trim() || DEFAULT_BRANDING.academicYear,
                slogan: inputBrandingSlogan?.value.trim() || DEFAULT_BRANDING.slogan,
                showStamp: inputBrandingStamp ? inputBrandingStamp.checked : true
            };
            saveBranding(updated);
            brandingModal.classList.add('hidden');
            showToast('🏫 Đã lưu cài đặt Trường & Thầy cô! Thông tin sẽ tự động hiển thị trên mọi phiếu chấm.', 'success');

            // Refresh preview if open
            if (previewSheetModal && !previewSheetModal.classList.contains('hidden')) {
                openPreviewModal();
            }
        });
    }

    // --- PRINTABLE SHEET BUILDER FOR PDF / IMAGE / PRINT ---
    function sanitizeFileName(name) {
        return name
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\s+/g, '_')
            .trim();
    }

    // --- PHÂN LOẠI MỨC ĐỘ NĂNG LỰC THEO THÔNG TƯ 22 BỘ GD&ĐT ---
    function getQuestionLevel(q) {
        const lvl = q?.level || '';
        if (lvl.includes('cao')) {
            return { key: 'vdc', label: 'Vận dụng cao', color: '#dc2626', bg: '#fee2e2', border: '#fecaca' };
        }
        if (lvl.includes('Vận dụng') || lvl.includes('vận dụng')) {
            return { key: 'vd', label: 'Vận dụng', color: '#d97706', bg: '#fef3c7', border: '#fde68a' };
        }
        if (lvl.includes('hiểu') || lvl.includes('Thông hiểu')) {
            return { key: 'th', label: 'Thông hiểu', color: '#16a34a', bg: '#dcfce7', border: '#bbf7d0' };
        }
        if (lvl.includes('Nhận biết') || lvl.includes('nhận biết')) {
            return { key: 'nb', label: 'Nhận biết', color: '#0284c7', bg: '#e0f2fe', border: '#bae6fd' };
        }
        // Fallback tự động suy luận thông minh
        const probe = `${q?.question || ''} ${q?.classification?.subtopic || ''} ${q?.problemStatementLatex || ''}`.toLowerCase();
        if (probe.includes('bất đẳng thức') || probe.includes('gtln') || probe.includes('gtnn') || probe.includes('thực tế') || (q?.maxScore && q.maxScore >= 3)) {
            return { key: 'vdc', label: 'Vận dụng cao', color: '#dc2626', bg: '#fee2e2', border: '#fecaca' };
        }
        if (probe.includes('chứng minh') || probe.includes('phương trình') || (q?.analysis && q.analysis.length >= 4)) {
            return { key: 'vd', label: 'Vận dụng', color: '#d97706', bg: '#fef3c7', border: '#fde68a' };
        }
        if (probe.includes('tính') || probe.includes('biến đổi') || (q?.analysis && q.analysis.length >= 2)) {
            return { key: 'th', label: 'Thông hiểu', color: '#16a34a', bg: '#dcfce7', border: '#bbf7d0' };
        }
        return { key: 'nb', label: 'Nhận biết', color: '#0284c7', bg: '#e0f2fe', border: '#bae6fd' };
    }

    // --- RENDER MÃ QR CODE LÊN CANVAS ---
    function drawFallbackQrCanvas(canvas) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width || 80;
        const h = canvas.height || 80;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1e3a8a';
        
        function drawFinder(x, y, size) {
            ctx.fillStyle = '#1e3a8a';
            ctx.fillRect(x, y, size, size);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x + size * 0.14, y + size * 0.14, size * 0.72, size * 0.72);
            ctx.fillStyle = '#1e3a8a';
            ctx.fillRect(x + size * 0.28, y + size * 0.28, size * 0.44, size * 0.44);
        }
        const s = w * 0.28;
        drawFinder(4, 4, s);
        drawFinder(w - s - 4, 4, s);
        drawFinder(4, h - s - 4, s);

        ctx.fillStyle = '#1e3a8a';
        const step = 3;
        for (let x = 4; x < w - 4; x += step) {
            for (let y = 4; y < h - 4; y += step) {
                if ((x < s + 6 && y < s + 6) || (x > w - s - 6 && y < s + 6) || (x < s + 6 && y > h - s - 6)) {
                    continue;
                }
                if (((x * 7 + y * 13) % 5 === 0) || ((x + y) % 3 === 0)) {
                    ctx.fillRect(x, y, step - 0.5, step - 0.5);
                }
            }
        }
    }

    function renderQrToCanvas(canvas, dataStr) {
        if (!canvas) return;
        canvas.width = 80;
        canvas.height = 80;
        if (window.QRCode && window.QRCode.toCanvas) {
            try {
                window.QRCode.toCanvas(canvas, dataStr, {
                    width: 80,
                    margin: 1,
                    color: { dark: '#1e3a8a', light: '#ffffff' }
                }, (err) => {
                    if (err) drawFallbackQrCanvas(canvas);
                });
                return;
            } catch (e) {
                console.warn('QRCode canvas error:', e);
            }
        }
        drawFallbackQrCanvas(canvas);
    }

    // --- MODAL TRA CỨU LỜI GIẢI QUA MÃ QR CODE ---
    window.openQrLookupModal = function(customData = null) {
        const data = customData || currentGradingData;
        const qrModal = document.getElementById('qr-lookup-modal');
        const qrBody = document.getElementById('qr-lookup-body');
        if (!qrModal || !qrBody || !data) return;

        const sName = document.getElementById('info-student-name')?.value || 'Học sinh';
        const sClass = document.getElementById('info-student-class')?.value || '8A';
        const lTitle = document.getElementById('info-lesson-title')?.value || 'Bài kiểm tra Toán';
        const score = data.score !== undefined ? data.score : 0;
        const tier = getScoreTier(score);

        let html = `
            <div class="qr-lookup-meta-card">
                <div>
                    <strong style="font-size: 15px; color: #166534; display: block;">${escapeHtml(sName)} - Lớp ${escapeHtml(sClass)}</strong>
                    <span style="font-size: 12px; color: #4b5563;">Bài thi: ${escapeHtml(lTitle)}</span>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 20px; font-weight: 800; color: ${tier.color};">${score.toFixed(1)}/10</span>
                    <span style="display: block; font-size: 11px; font-weight: 700; color: ${tier.color};">${tier.badge}</span>
                </div>
            </div>
            
            <div style="font-size: 12.5px; font-weight: 700; color: #1e3a8a; margin-top: 6px;">
                📘 ĐÁP ÁN CHUẨN & LỜI GIẢI CHI TIẾT CÁC CÂU HỎI:
            </div>
        `;

        if (data.questions && data.questions.length > 0) {
            data.questions.forEach((q, idx) => {
                const qId = q.questionId || q.question || `${idx + 1}`;
                const lvl = getQuestionLevel(q);
                const isCor = q.status === 'correct';
                html += `
                    <div class="qr-lookup-solution-card">
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; margin-bottom: 8px;">
                            <div>
                                <strong style="color: #1e293b; font-size: 13.5px;">Câu ${qId}</strong>
                                <span class="badge-tag level level-${lvl.key}" style="margin-left: 6px; font-size: 10.5px;">${lvl.label}</span>
                            </div>
                            <span style="font-size: 11.5px; font-weight: 700; color: ${isCor ? '#15803d' : '#b91c1c'};">${isCor ? '✅ Đúng' : '❌ Cần xem lại'}</span>
                        </div>
                `;
                if (q.referenceSolution) {
                    if (q.referenceSolution.steps) {
                        q.referenceSolution.steps.forEach(st => {
                            html += `
                                <div style="font-size: 12px; margin-top: 4px; color: #334155;">
                                    <strong>Bước ${st.stepNumber}:</strong> ${renderLatexToHtml(st.solutionLatex, false)}
                                    <span style="font-size: 11px; color: #64748b;">(${escapeHtml(st.explanation || st.solutionText || '')})</span>
                                </div>
                            `;
                        });
                    }
                    if (q.referenceSolution.finalAnswerLatex) {
                        html += `
                            <div style="margin-top: 6px; font-size: 12px; font-weight: 700; color: #1e40af;">
                                🏁 Đáp số chuẩn: ${renderLatexToHtml(q.referenceSolution.finalAnswerLatex, false)}
                            </div>
                        `;
                    }
                } else if (q.feedback) {
                    html += `<div style="font-size: 12px; color: #475569;">${formatMathText(q.feedback)}</div>`;
                }
                html += `</div>`;
            });
        }

        qrBody.innerHTML = html;

        if (window.renderMathInElement) {
            try {
                window.renderMathInElement(qrBody, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '\\[', right: '\\]', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false}
                    ],
                    throwOnError: false
                });
            } catch (e) {
                console.warn(e);
            }
        }

        qrModal.classList.remove('hidden');
    };

    // --- SMART A4 PRINTABLE SHEET BUILDER ---
    function buildPrintableSheet(customData = null, customImages = null, customInfo = null) {
        const sheet = document.getElementById('printable-student-sheet');
        let data = customData || currentGradingData;
        if (!sheet || !data) return sheet;
        data = sanitizeMathData(data);

        const branding = getBranding();

        const studentName = customInfo?.name || document.getElementById('info-student-name')?.value || 'Nguyễn Văn A';
        const studentClass = customInfo?.class || document.getElementById('info-student-class')?.value || '8A';
        const lessonTitle = customInfo?.title || document.getElementById('info-lesson-title')?.value || 'Bài kiểm tra Toán';
        const gradingDate = customInfo?.date || document.getElementById('info-grading-date')?.value || new Date().toLocaleDateString('vi-VN');

        const sheetImages = (customImages && customImages.length > 0)
            ? customImages
            : ((currentGradingImages && currentGradingImages.length > 0)
                ? currentGradingImages
                : (selectedFileUrl ? [{ pageIndex: 0, dataUrl: selectedFileUrl }] : []));

        const finalScore = (data.score !== undefined ? data.score : 0);
        const scoreTier = getScoreTier(finalScore);

        let cntNb = 0, cntTh = 0, cntVd = 0, cntVdc = 0;
        if (data.questions && data.questions.length > 0) {
            data.questions.forEach(q => {
                const lvl = getQuestionLevel(q);
                if (lvl.key === 'nb') cntNb++;
                else if (lvl.key === 'th') cntTh++;
                else if (lvl.key === 'vd') cntVd++;
                else if (lvl.key === 'vdc') cntVdc++;
            });
        }

        const teacherDisplay = (branding.teacherName || '').toLowerCase().startsWith('gv') || (branding.teacherName || '').toLowerCase().startsWith('giáo viên')
            ? `<strong>${escapeHtml(branding.teacherName)}</strong>`
            : `GV phụ trách: <strong>${escapeHtml(branding.teacherName)}</strong>`;

        let html = `
            <!-- TIÊU ĐỀ TRƯỜNG HỌC & QUỐC HIỆU CHÍNH THỨC -->
            <div class="ps-header-block" style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 4px; margin-bottom: 6px;">
                <div style="text-align: left;">
                    <div style="font-size: 11.5px; font-weight: 800; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.4px;">${escapeHtml(branding.schoolName)}</div>
                    <div style="font-size: 10.5px; color: #475569; font-weight: 700;">${escapeHtml(branding.department)}</div>
                    <div style="font-size: 9.5px; color: #64748b; margin-top: 1px;">${teacherDisplay} • ${escapeHtml(branding.academicYear)}</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 10.5px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.4px;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
                    <div style="font-size: 10px; font-weight: 700; color: #334155;">Độc lập - Tự do - Hạnh phúc</div>
                    <div style="font-size: 9.5px; font-style: italic; color: #64748b; margin-top: 1px;">"${escapeHtml(branding.slogan)}"</div>
                </div>
            </div>

            <!-- EXECUTIVE BANNER HEADER (COMPACT) -->
            <div class="ps-header-block" style="position: relative; background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); color: #ffffff; padding: 7px 12px; border-radius: 6px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 9px;">
                    <img src="assets/icons/app-logo.png" alt="Toán Matsuda AI" style="width: 34px; height: 34px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); border: 1.5px solid rgba(255,255,255,0.4); flex-shrink: 0; object-fit: contain;">
                    <div>
                        <div style="font-size: 8.5px; text-transform: uppercase; letter-spacing: 1.1px; opacity: 0.9; margin-bottom: 1px;">TOÁN MATSUDA AI • HỆ THỐNG ĐÁNH GIÁ SƯ PHẠM THCS</div>
                        <div style="font-size: 14.5px; font-weight: 800; letter-spacing: 0.3px; line-height: 1.2;">PHIẾU BÁO ĐIỂM & ĐÁNH GIÁ NĂNG LỰC TOÁN HỌC</div>
                        <div style="font-size: 9.5px; opacity: 0.92; margin-top: 1px;">Phân tích sư phạm chuyên sâu • Nhận diện lỗi gốc & Hướng dẫn sửa từng bước</div>
                    </div>
                </div>
                <div style="text-align: right; background: rgba(255,255,255,0.18); padding: 4px 10px; border-radius: 5px; backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.3); min-width: 85px;">
                    <div style="font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.5px;">Xếp loại</div>
                    <div style="font-size: 12px; font-weight: 800;">${scoreTier.badge}</div>
                </div>
            </div>

            ${data.isTeacherEdited ? `
                <div style="background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 4px 10px; border-radius: 4px; font-weight: 700; margin-bottom: 6px; font-size: 11px; display: flex; align-items: center; gap: 6px;">
                    <span>✏️ <strong>KẾT QUẢ ĐÃ ĐƯỢC GIÁO VIÊN ĐỐI CHIẾU & CẬP NHẬT THỦ CÔNG</strong></span>
                </div>
            ` : ''}

            <!-- DẤU MỘC ĐỎ KIỂM DUYỆT SƯ PHẠM (NẾU BẬT) -->
            ${branding.showStamp ? `
                <div style="position: absolute; right: 18px; top: 68px; width: 70px; height: 70px; border: 2px dashed #dc2626; border-radius: 50%; color: #dc2626; transform: rotate(-10deg); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: none; opacity: 0.85; font-weight: 800; line-height: 1.05; padding: 2px; z-index: 5;">
                    <span style="font-size: 6px; text-transform: uppercase; letter-spacing: 0.5px;">TOÁN SƯ PHẠM</span>
                    <span style="font-size: 8.5px; margin: 1px 0; font-weight: 900;">★ ĐÃ KIỂM TRA ★</span>
                    <span style="font-size: 6px; font-weight: 700;">ĐIỂM CHUẨN XÁC</span>
                </div>
            ` : ''}

            <!-- STUDENT INFO & SCORE OVERVIEW DASHBOARD (COMPACT) -->
            <div style="display: grid; grid-template-columns: 1fr 160px; gap: 8px; margin-bottom: 6px;">
                <table style="width: 100%; border-collapse: collapse; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; overflow: hidden;">
                    <tr>
                        <td style="padding: 4px 8px; font-size: 11px; border: 1px solid #e2e8f0; width: 50%;">
                            <span style="color: #64748b; font-size: 9.5px; display: block; line-height: 1.1;">HỌC SINH:</span>
                            <strong style="color: #1e293b; font-size: 12.5px;">${escapeHtml(studentName)}</strong>
                        </td>
                        <td style="padding: 4px 8px; font-size: 11px; border: 1px solid #e2e8f0; width: 50%;">
                            <span style="color: #64748b; font-size: 9.5px; display: block; line-height: 1.1;">LỚP:</span>
                            <strong style="color: #1e293b; font-size: 12.5px;">${escapeHtml(studentClass)}</strong>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 4px 8px; font-size: 11px; border: 1px solid #e2e8f0;">
                            <span style="color: #64748b; font-size: 9.5px; display: block; line-height: 1.1;">BÀI KIỂM TRA:</span>
                            <strong style="color: #1e293b; font-size: 11.5px;">${escapeHtml(lessonTitle)}</strong>
                        </td>
                        <td style="padding: 4px 8px; font-size: 11px; border: 1px solid #e2e8f0;">
                            <span style="color: #64748b; font-size: 9.5px; display: block; line-height: 1.1;">NGÀY CHẤM:</span>
                            <strong style="color: #1e293b; font-size: 11.5px;">${escapeHtml(gradingDate)}</strong>
                        </td>
                    </tr>
                </table>

                <div style="background: ${scoreTier.bg}; border: 1.5px solid ${scoreTier.border}; border-radius: 5px; padding: 4px 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
                    <span style="font-size: 9.5px; font-weight: 700; color: ${scoreTier.color}; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1;">Điểm tổng kết</span>
                    <div style="font-size: 22px; font-weight: 800; color: ${scoreTier.color}; line-height: 1.1; margin: 1px 0;">
                        ${finalScore.toFixed(1)}<span style="font-size: 13px; font-weight: 600; color: #64748b;"> / 10</span>
                    </div>
                    <span style="background: #ffffff; color: ${scoreTier.color}; border: 1px solid ${scoreTier.border}; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px;">
                        ${scoreTier.badge}
                    </span>
                </div>
            </div>

            <!-- TEACHER / AI SUMMARY CALLOUT (COMPACT) -->
            ${exportOptions.totalScore && data.summary ? `
                <div style="background: #eff6ff; border-left: 3px solid #2563eb; border-radius: 0 5px 5px 0; padding: 5px 10px; margin-bottom: 6px;">
                    <div style="font-size: 11px; font-weight: 700; color: #1e40af; margin-bottom: 2px; display: flex; align-items: center; gap: 5px;">
                        <span>👨‍🏫 LỜI PHÊ & NHẬN XÉT SƯ PHẠM TỔNG QUAN:</span>
                    </div>
                    <div style="font-size: 11.5px; color: #1e293b; line-height: 1.35; font-style: italic;">
                        "${formatMathText(data.summary)}"
                    </div>
                </div>
            ` : ''}

            <!-- MA TRẬN MỨC ĐỘ NĂNG LỰC THEO THÔNG TƯ 22 BỘ GD&ĐT (COMPACT) -->
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 10px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; color: #334155;">
                <strong style="color: #1e3a8a; display: flex; align-items: center; gap: 4px;">🎯 Ma trận đề (Thông tư 22):</strong>
                <span>🟢 Nhận biết: <strong>${cntNb}</strong> câu</span>
                <span>🔵 Thông hiểu: <strong>${cntTh}</strong> câu</span>
                <span>🟠 Vận dụng: <strong>${cntVd}</strong> câu</span>
                <span>🔴 Vận dụng cao: <strong>${cntVdc}</strong> câu</span>
            </div>
        `;

        // Questions List
        if (data.questions && data.questions.length > 0) {
            data.questions.forEach((q, idx) => {
                const qId = q.questionId || q.question || `${idx + 1}`;
                const score = q.score !== undefined ? q.score : 0;
                const maxScore = q.maxScore || q.max_score || 10;
                const resultText = q.result || (q.status === 'correct' ? 'Đúng' : 'Sai');
                const isCorrect = q.status === 'correct';
                const lvlInfo = getQuestionLevel(q);

                let psClassStr = `<span style="background: ${lvlInfo.bg}; color: ${lvlInfo.color}; border: 1px solid ${lvlInfo.border}; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 4px; margin-left: 5px;">${lvlInfo.label}</span>`;
                if (q.classification) {
                    const parts = [q.classification.grade, q.classification.topic, q.classification.subtopic].filter(Boolean);
                    if (parts.length > 0) psClassStr += `<span style="font-size: 10.5px; color: #64748b; font-weight: 500; margin-left: 5px;">[${parts.map(escapeHtml).join(' • ')}]</span>`;
                }

                html += `
                    <div class="ps-question-item" style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; background: #ffffff;">
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 6px;">
                            <div>
                                <span style="font-size: 13.5px; font-weight: 800; color: #1e293b;">CÂU ${qId}</span>
                                ${psClassStr}
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                ${exportOptions.questionScores ? `<span style="font-size: 12.5px; font-weight: 800; color: #2563eb;">${score}/${maxScore} điểm</span>` : ''} 
                                <span style="background: ${isCorrect ? '#dcfce7' : '#fee2e2'}; color: ${isCorrect ? '#15803d' : '#b91c1c'}; border: 1px solid ${isCorrect ? '#bbf7d0' : '#fecaca'}; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px;">
                                    ${isCorrect ? '✅' : '❌'} ${resultText}
                                </span>
                            </div>
                        </div>
                `;

                // Reference solution if selected
                if (exportOptions.referenceSolution && q.referenceSolution) {
                    html += `
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #2563eb; border-radius: 0 5px 5px 0; padding: 6px 8px; margin-bottom: 6px;">
                            <strong style="color: #2563eb; font-size: 11px; text-transform: uppercase;">📘 Đáp án chuẩn AI tự giải:</strong>
                    `;
                    if (q.referenceSolution.domainConditionLatex) {
                        html += `<div style="font-size: 10.5px; margin-top: 2px;"><strong>ĐKXĐ:</strong> ${renderLatexToHtml(q.referenceSolution.domainConditionLatex, false)}</div>`;
                    }
                    if (q.referenceSolution.variableDeclaration) {
                        html += `<div style="font-size: 10.5px; margin-top: 2px;"><strong>Gọi ẩn & ĐK:</strong> ${formatMathText(q.referenceSolution.variableDeclaration)}</div>`;
                    }
                    if (q.referenceSolution.hypothesisLatex || q.referenceSolution.conclusionLatex) {
                        html += `<div style="font-size: 10.5px; margin-top: 2px;">`;
                        if (q.referenceSolution.hypothesisLatex) html += `<span><strong>GT:</strong> ${renderLatexToHtml(q.referenceSolution.hypothesisLatex, false)}</span> `;
                        if (q.referenceSolution.conclusionLatex) html += `<span style="margin-left: 6px;"><strong>KL:</strong> ${renderLatexToHtml(q.referenceSolution.conclusionLatex, false)}</span>`;
                        html += `</div>`;
                    }
                    if (q.referenceSolution.steps) {
                        q.referenceSolution.steps.forEach(st => {
                            html += `<div style="font-size: 11px; margin-top: 3px;">• <strong>Bước ${st.stepNumber}:</strong> ${renderLatexToHtml(st.solutionLatex, false)} <span style="color: #64748b; font-size: 10px;">(${escapeHtml(st.explanation || st.solutionText || '')})</span></div>`;
                        });
                    }
                    if (q.referenceSolution.finalAnswerLatex) {
                        html += `<div style="margin-top: 4px; font-weight: 700; color: #1e3a8a; font-size: 11px;">🏁 Kết luận / Đáp số: ${renderLatexToHtml(q.referenceSolution.finalAnswerLatex, false)}</div>`;
                    }
                    html += `</div>`;
                }

                // Step analysis
                if (exportOptions.stepAnalysis && q.analysis && q.analysis.length > 0) {
                    q.analysis.forEach(step => {
                        const stepCorrect = step.status === 'correct';
                        const isFirstErr = !!step.isFirstError && exportOptions.firstError;
                        const isCascading = step.status === 'cascading_error' || !!step.isFollowUpError;
                        const isIndependent = !!step.isIndependentError;
                        const isIncomplete = step.status === 'incomplete';
                        const isUnclear = step.status === 'unclear';

                        let stepBg = '#ffffff';
                        let stepBorder = '#e2e8f0';
                        let badgeHtml = '';

                        if (stepCorrect) {
                            badgeHtml = '<span style="background: #dcfce7; color: #15803d; font-weight: 700; font-size: 10px; padding: 1.5px 6px; border-radius: 4px; border: 1px solid #bbf7d0;">✅ ĐÚNG</span>';
                        } else if (isFirstErr) {
                            stepBg = '#fff5f5';
                            stepBorder = '#ef4444';
                            badgeHtml = '<span style="background: #ef4444; color: #ffffff; font-weight: 800; font-size: 10px; padding: 1.5px 6px; border-radius: 4px;">🎯 LỖI ĐẦU TIÊN (Lỗi gốc)</span>';
                        } else if (isCascading) {
                            stepBg = '#fffbeb';
                            stepBorder = '#f59e0b';
                            badgeHtml = '<span style="background: #fef3c7; color: #b45309; font-weight: 700; font-size: 10px; padding: 1.5px 6px; border-radius: 4px; border: 1px solid #fde68a;">⚠️ LỖI KÉO THEO</span>';
                        } else if (isIndependent) {
                            stepBg = '#fff1f2';
                            stepBorder = '#e11d48';
                            badgeHtml = '<span style="background: #fee2e2; color: #b91c1c; font-weight: 700; font-size: 10px; padding: 1.5px 6px; border-radius: 4px; border: 1px solid #fecdd3;">❌ LỖI ĐỘC LẬP</span>';
                        } else if (isIncomplete) {
                            badgeHtml = '<span style="background: #fef3c7; color: #92400e; font-weight: 700; font-size: 10px; padding: 1.5px 6px; border-radius: 4px;">⚠️ CHƯA HOÀN THIỆN</span>';
                        } else if (isUnclear) {
                            badgeHtml = '<span style="background: #f1f5f9; color: #475569; font-weight: 700; font-size: 10px; padding: 1.5px 6px; border-radius: 4px;">⚠️ KHÔNG ĐỌC RÕ</span>';
                        } else {
                            badgeHtml = '<span style="background: #fee2e2; color: #b91c1c; font-weight: 700; font-size: 10px; padding: 1.5px 6px; border-radius: 4px;">❌ SAI</span>';
                        }

                        const pageNotice = (sheetImages.length > 1 && step.pageIndex !== undefined) ? ` <span style="font-size: 9.5px; background: #e2e8f0; color: #475569; padding: 1px 4px; border-radius: 3px; font-weight: normal;">Trang ${step.pageIndex + 1}</span>` : '';

                        const stepPageIdx = (step.pageIndex !== undefined && step.pageIndex >= 0 && step.pageIndex < sheetImages.length) ? step.pageIndex : 0;
                        const stepImgUrl = sheetImages[stepPageIdx]?.dataUrl || sheetImages[0]?.dataUrl;

                        let stepCropHtml = '';
                        if (stepImgUrl && step.bbox && step.bbox.width > 0 && step.bbox.height > 0) {
                            const bx = Math.max(0, Math.min(100, step.bbox.x));
                            const by = Math.max(0, Math.min(100, step.bbox.y));
                            const bw = Math.max(5, Math.min(100, step.bbox.width));
                            const bh = Math.max(5, Math.min(100, step.bbox.height));
                            const topPct = -((by / bh) * 100);
                            const leftPct = -((bx / bw) * 100);
                            const widthPct = (100 / bw) * 100;
                            const heightPct = (100 / bh) * 100;
                            stepCropHtml = `
                                <div style="position: relative; width: 100%; height: 48px; border-radius: 4px; overflow: hidden; border: 1px solid #cbd5e1; background: #0f172a; margin: 4px 0;">
                                    <img src="${stepImgUrl}" style="position: absolute; top: ${topPct}%; left: ${leftPct}%; width: ${widthPct}%; height: ${heightPct}%; max-width: none;" alt="Vùng chữ bước ${step.stepNumber}">
                                </div>
                            `;
                        }

                        html += `
                            <div class="ps-step-card ps-step-avoid" style="background: ${stepBg}; border: 1px solid ${stepBorder}; border-radius: 5px; padding: 6px 8px; margin-bottom: 5px; page-break-inside: avoid; break-inside: avoid;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                                    <span style="font-weight: 800; font-size: 11.5px; color: #1e293b;">Bước ${step.stepNumber}${pageNotice}</span>
                                    <div>${badgeHtml}</div>
                                </div>
                                ${stepCropHtml}
                                <div style="margin: 2px 0; font-size: 12px;">
                                    <span style="font-weight: 700; color: #475569;">Học sinh viết:</span>
                                    <span style="margin-left: 4px;">${renderLatexToHtml(step.studentLatex, false)}</span>
                                </div>
                                ${step.comment ? `
                                    <div style="font-size: 11px; color: #334155; margin-top: 3px; background: rgba(0,0,0,0.02); padding: 3px 6px; border-radius: 4px; line-height: 1.35;">
                                        <strong>Nhận xét:</strong> ${formatMathText(step.comment)}
                                    </div>
                                ` : ''}
                                ${exportOptions.corrections && step.correctionLatex ? `
                                    <div style="background: #fff1f2; border-left: 3px solid #f43f5e; padding: 3px 6px; font-size: 11px; color: #9f1239; margin-top: 3px; border-radius: 0 4px 4px 0; line-height: 1.35;">
                                        <strong>💡 Cách sửa:</strong> ${renderLatexToHtml(step.correctionLatex, false)}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    });
                } else if (q.feedback) {
                    html += `<div style="font-size: 11px; color: #334155; margin-top: 3px; line-height: 1.35;"><strong>Nhận xét:</strong> ${formatMathText(q.feedback)}</div>`;
                }

                html += `</div>`; // Close ps-question-item
            });
        }

        // Student work preview image if enabled
        if (exportOptions.studentImg && sheetImages.length > 0) {
            sheetImages.forEach((imgObj, pIdx) => {
                html += `
                    <div class="ps-card-avoid" style="margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; text-align: center; page-break-inside: avoid; break-inside: avoid; background: #ffffff;">
                        <div style="font-weight: 700; font-size: 11px; margin-bottom: 4px; text-align: left; color: #1e293b;">
                            📝 ẢNH BÀI LÀM GỐC CỦA HỌC SINH ${sheetImages.length > 1 ? `(Trang ${pIdx + 1}/${sheetImages.length})` : ''}:
                        </div>
                        <img src="${imgObj.dataUrl}" alt="Ảnh bài làm trang ${pIdx + 1}" style="max-width: 100%; max-height: 180px; object-fit: contain; border-radius: 4px; border: 1px solid #e2e8f0;">
                    </div>
                `;
            });
        }

        // General comment: 3 Colored Insight Cards
        if (exportOptions.overallFeedback) {
            const gc = data.generalComment || {};
            const strengths = gc.strengths || [];
            const errors = gc.mainErrors || [];
            const review = gc.knowledgeToReview || [];
            const overall = data.overall_feedback || [];

            if (strengths.length > 0 || errors.length > 0 || review.length > 0 || overall.length > 0) {
                html += `
                    <div class="ps-card-avoid" style="margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; background: #f8fafc; page-break-inside: avoid; break-inside: avoid;">
                        <div style="font-weight: 800; font-size: 11.5px; color: #1e293b; margin-bottom: 6px; display: flex; align-items: center; gap: 5px;">
                            <span>📊 TỔNG KẾT ĐÁNH GIÁ SƯ PHẠM & LỜI KHUYÊN PHÁT TRIỂN</span>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px;">
                            ${strengths.length > 0 ? `
                                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; padding: 5px 8px;">
                                    <div style="color: #15803d; font-weight: 700; font-size: 10px; margin-bottom: 2px;">✓ ĐIỂM SÁNG (ƯU ĐIỂM)</div>
                                    <div style="font-size: 10.5px; color: #166534; line-height: 1.35;">${strengths.map(escapeHtml).join('; ')}</div>
                                </div>
                            ` : ''}
                            ${errors.length > 0 ? `
                                <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 4px; padding: 5px 8px;">
                                    <div style="color: #b91c1c; font-weight: 700; font-size: 10px; margin-bottom: 2px;">⚠ LỖI CẦN LƯU Ý</div>
                                    <div style="font-size: 10.5px; color: #991b1b; line-height: 1.35;">${errors.map(escapeHtml).join('; ')}</div>
                                </div>
                            ` : ''}
                            ${review.length > 0 ? `
                                <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px; padding: 5px 8px;">
                                    <div style="color: #0369a1; font-weight: 700; font-size: 10px; margin-bottom: 2px;">💡 TRỌNG TÂM ÔN TẬP</div>
                                    <div style="font-size: 10.5px; color: #075985; line-height: 1.35;">${review.map(escapeHtml).join('; ')}</div>
                                </div>
                            ` : ''}
                        </div>
                        ${overall.length > 0 ? `
                            <div style="margin-top: 5px; font-size: 11px; color: #334155; line-height: 1.35;">
                                <strong>Lời khuyên chung:</strong> ${overall.map(escapeHtml).join('; ')}
                            </div>
                        ` : ''}
                    </div>
                `;
            }
        }

        // V. BÀI TẬP BỔ TRỢ & RÈN LUYỆN TẠI NHÀ (NẾU BẬT TÙY CHỌN)
        if (exportOptions.remedialExercises) {
            const remedialItems = generateRemedialQuestions(data);
            if (remedialItems && remedialItems.length > 0) {
                html += `
                    <div class="ps-card-avoid" style="margin-top: 8px; border: 1.5px solid #0284c7; border-radius: 6px; padding: 8px 10px; background: #ffffff; page-break-inside: avoid; break-inside: avoid;">
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e0f2fe; padding-bottom: 4px; margin-bottom: 6px;">
                            <div>
                                <span style="font-size: 11.5px; font-weight: 800; color: #0369a1; text-transform: uppercase;">🎯 V. BÀI TẬP BỔ TRỢ & RÈN LUYỆN TẠI NHÀ</span>
                                <div style="font-size: 9.5px; color: #64748b;">Khắc phục lỗ hổng kiến thức theo đề xuất của AI & Giáo viên</div>
                            </div>
                            <span style="background: #e0f2fe; color: #0284c7; font-weight: 700; font-size: 10px; padding: 1.5px 6px; border-radius: 4px;">${remedialItems.length} BÀI TẬP</span>
                        </div>
                `;

                remedialItems.forEach((rm, rIdx) => {
                    html += `
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; padding: 6px 8px; margin-bottom: 6px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; flex-wrap: wrap; gap: 4px;">
                                <strong style="color: #1e3a8a; font-size: 11px;">Bài ${rIdx + 1}: ${formatMathText(rm.title || 'Rèn luyện kỹ năng')} ${rm.targetQuestion ? `<span style="font-size: 10px; color: #64748b; font-weight: normal;">[${escapeHtml(rm.targetQuestion)}]</span>` : ''}</strong>
                                ${rm.weakness ? `<span style="font-size: 10px; color: #b91c1c; font-weight: 600;">⚠️ ${escapeHtml(rm.weakness)}</span>` : ''}
                            </div>
                            <div style="font-size: 11px; color: #1e293b; line-height: 1.35; margin-bottom: 4px;">
                                <strong>Đề bài:</strong> ${formatMathText(rm.problemLatex || '')}
                            </div>
                            <div style="font-size: 10.5px; color: #92400e; background: #fffbeb; padding: 4px 8px; border-radius: 4px; border-left: 3px solid #f59e0b; margin-bottom: 4px; line-height: 1.35;">
                                <strong>💡 Gợi ý phương pháp:</strong> ${formatMathText(rm.hint || '')}
                            </div>
                            <div style="border-top: 1px dashed #cbd5e1; padding-top: 3px; min-height: 24px; font-size: 9.5px; color: #94a3b8; font-style: italic;">
                                (Học sinh trình bày bài làm củng cố vào đây và nộp lại cho thầy/cô...)
                            </div>
                        </div>
                    `;
                });

                html += `</div>`;
            }
        }

        // Signatures & QR Code Verification (COMPACT)
        html += `
            <div class="ps-signatures-block" style="margin-top: 10px; display: flex; justify-content: space-between; align-items: flex-end; padding: 0 14px; text-align: center; font-size: 11px; page-break-inside: avoid; break-inside: avoid;">
                <div style="width: 160px;">
                    <strong style="color: #1e293b;">Ý KIẾN PHỤ HUYNH</strong><br>
                    <span style="font-size: 9.5px; color: #64748b;">(Ký và ghi rõ họ tên)</span>
                    <div style="height: 26px; border-bottom: 1px dashed #cbd5e1; width: 130px; margin: 2px auto 0;"></div>
                </div>

                <!-- MÃ QR TRA CỨU ĐÁP ÁN & LỜI GIẢI CHI TIẾT -->
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;" onclick="if(window.openQrLookupModal) window.openQrLookupModal();" title="Nhấn hoặc quét mã QR để tra cứu lời giải chi tiết và đáp án trực tuyến">
                    <div class="qr-code-box" style="padding: 2px; background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 6px;">
                        <canvas class="print-sheet-qr-canvas" style="width: 58px; height: 58px; display: block;"></canvas>
                    </div>
                    <span style="font-size: 8.5px; color: #475569; font-weight: 700; margin-top: 2px; text-align: center; max-width: 120px; line-height: 1.15;">
                        📱 Quét mã xem lời giải chi tiết
                    </span>
                </div>

                <div style="width: 180px;">
                    <span style="font-size: 10px; color: #64748b; font-style: italic;">Hà Nội, ngày ...... tháng ...... năm 20...</span><br>
                    <strong style="color: #1e293b;">GIÁO VIÊN BỘ MÔN TOÁN</strong><br>
                    <span style="font-size: 9.5px; color: #64748b;">(Ký và ghi rõ họ tên)</span>
                    <div style="height: 24px; margin: 2px auto 0;"></div>
                    <strong style="color: #1e3a8a; font-size: 12px; display: block;">${escapeHtml(branding.teacherName)}</strong>
                </div>
            </div>
            
            <!-- WATERMARK FOOTER -->
            <div style="margin-top: 8px; text-align: center; font-size: 9.5px; color: #94a3b8; border-top: 1px dashed #e2e8f0; padding-top: 4px;">
                📐 TOÁN MATSUDA AI • Nền tảng Đánh giá & Hỗ trợ Sư phạm THCS Tự động
            </div>
        `;

        sheet.innerHTML = html;

        // Render QR Code onto the canvas
        const qrCanvas = sheet.querySelector('.print-sheet-qr-canvas');
        if (qrCanvas) {
            renderQrToCanvas(qrCanvas, `MATSUDA-AI|${studentName}|${finalScore}|${gradingDate}|${lessonTitle}`);
        }

        // Render KaTeX for sheet
        if (window.renderMathInElement) {
            try {
                window.renderMathInElement(sheet, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '\\[', right: '\\]', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false}
                    ],
                    throwOnError: false
                });
            } catch (err) {
                console.warn('Auto-render print sheet error:', err);
            }
        }

        return sheet;
    }

    // --- REUSABLE EXPORT & PREVIEW HELPERS ---
    async function exportSinglePdf(data = null, images = null, info = null) {
        const targetData = data || currentGradingData;
        if (!targetData) return;
        const sheet = buildPrintableSheet(targetData, images, info);
        const sName = info?.name || document.getElementById('info-student-name')?.value || 'HocSinh';
        const lTitle = info?.title || document.getElementById('info-lesson-title')?.value || 'BaiToan';
        const fileName = sanitizeFileName(`Ket_qua_cham_${sName}_${lTitle}`) + '.pdf';

        if (window.html2pdf) {
            const opt = {
                margin: [4, 6, 4, 6], // 4mm trên, 6mm phải, 4mm dưới, 6mm trái
                filename: fileName,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    logging: false,
                    scrollY: 0,
                    scrollX: 0,
                    y: 0,
                    x: 0,
                    windowWidth: 794
                },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['css', 'legacy'], avoid: ['.ps-step-avoid', '.ps-signatures-block', '.ps-card-avoid'] }
            };

            const wrapper = document.getElementById('export-sheet-wrapper');
            wrapper.style.display = 'block';
            wrapper.style.position = 'fixed';
            wrapper.style.top = '0px';
            wrapper.style.left = '0px';
            wrapper.style.zIndex = '-9999';
            try {
                await window.html2pdf().set(opt).from(sheet).save();
                showToast(`Đã xuất file PDF cho học sinh ${sName}!`, 'success');
            } finally {
                wrapper.style.display = 'none';
            }
        } else {
            window.print();
        }
    }

    async function exportSingleImage(data = null, images = null, info = null, formatChoice = null) {
        const targetData = data || currentGradingData;
        if (!targetData) return;
        const sheet = buildPrintableSheet(targetData, images, info);
        const sName = info?.name || document.getElementById('info-student-name')?.value || 'HocSinh';
        const lTitle = info?.title || document.getElementById('info-lesson-title')?.value || 'BaiToan';

        const isPaged = formatChoice === 'paged' || (document.getElementById('opt-img-paged')?.checked);

        if (window.html2canvas) {
            const wrapper = document.getElementById('export-sheet-wrapper');
            wrapper.style.display = 'block';
            wrapper.style.position = 'fixed';
            wrapper.style.top = '0px';
            wrapper.style.left = '0px';
            wrapper.style.zIndex = '-9999';
            try {
                const canvas = await window.html2canvas(sheet, {
                    scale: 2,
                    useCORS: true,
                    scrollY: 0,
                    scrollX: 0,
                    y: 0,
                    x: 0,
                    windowWidth: 794,
                    backgroundColor: '#ffffff'
                });

                const canvasHeight = canvas.height;
                const canvasWidth = canvas.width;
                const maxSliceHeight = 2200; // ~1100 CSS px at scale 2

                if (!isPaged || canvasHeight <= maxSliceHeight) {
                    // Export one complete long infographic image
                    const fileName = sanitizeFileName(`Ket_qua_cham_${sName}_${lTitle}`) + '.png';
                    const link = document.createElement('a');
                    link.download = fileName;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                    showToast(`Đã xuất ảnh phiếu chấm cho học sinh ${sName}!`, 'success');
                } else {
                    // Slice by A4 pages
                    const numSlices = Math.ceil(canvasHeight / maxSliceHeight);
                    for (let i = 0; i < numSlices; i++) {
                        const sliceCanvas = document.createElement('canvas');
                        sliceCanvas.width = canvasWidth;
                        const currentSliceHeight = Math.min(maxSliceHeight, canvasHeight - (i * maxSliceHeight));
                        sliceCanvas.height = currentSliceHeight;
                        const ctx = sliceCanvas.getContext('2d');
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
                        ctx.drawImage(
                            canvas,
                            0, i * maxSliceHeight, canvasWidth, currentSliceHeight,
                            0, 0, canvasWidth, currentSliceHeight
                        );
                        const sliceName = sanitizeFileName(`Ket_qua_cham_${sName}_${lTitle}_Trang_${i + 1}`) + '.png';
                        const link = document.createElement('a');
                        link.download = sliceName;
                        link.href = sliceCanvas.toDataURL('image/png');
                        link.click();
                    }
                    showToast(`Đã xuất ${numSlices} ảnh trang A4 cho học sinh ${sName}!`, 'success');
                }
            } finally {
                wrapper.style.display = 'none';
            }
        } else {
            showToast('Thư viện tạo ảnh chưa sẵn sàng.', 'warning');
        }
    }

    async function copySingleImageToClipboard(data = null, images = null, info = null) {
        const targetData = data || currentGradingData;
        if (!targetData) return;
        const sheet = buildPrintableSheet(targetData, images, info);

        if (!navigator.clipboard || !window.ClipboardItem) {
            showToast('Trình duyệt của bạn chưa hỗ trợ sao chép ảnh trực tiếp. Vui lòng nhấn nút "Xuất ảnh".', 'warning');
            return;
        }

        const wrapper = document.getElementById('export-sheet-wrapper');
        wrapper.style.display = 'block';
        try {
            showToast('Đang kết xuất ảnh để sao chép...', 'info');
            const canvas = await window.html2canvas(sheet, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff'
            });

            canvas.toBlob(async (blob) => {
                if (blob) {
                    try {
                        await navigator.clipboard.write([
                            new ClipboardItem({ 'image/png': blob })
                        ]);
                        showToast('📋 Đã sao chép ảnh phiếu vào bộ nhớ tạm! Bạn có thể dán ngay (Ctrl + V) vào Zalo hoặc Messenger.', 'success');
                    } catch (clipErr) {
                        console.error('Clipboard write error:', clipErr);
                        showToast('Không thể dán vào clipboard do quyền trình duyệt. Vui lòng bấm Xuất ảnh.', 'warning');
                    }
                }
            }, 'image/png');
        } catch (err) {
            console.error('Error copying sheet image:', err);
            showToast('Lỗi khi sao chép ảnh phiếu.', 'error');
        } finally {
            wrapper.style.display = 'none';
        }
    }

    // --- PREVIEW SHEET MODAL LOGIC ---
    const btnPreviewSheet = document.getElementById('btn-preview-sheet');
    const previewSheetModal = document.getElementById('preview-sheet-modal');
    const previewSheetContainer = document.getElementById('preview-sheet-container');
    const btnPreviewModalClose = document.getElementById('btn-preview-modal-close');
    const btnPreviewModalPrint = document.getElementById('btn-preview-modal-print');
    const btnPreviewModalPdf = document.getElementById('btn-preview-modal-pdf');
    const btnPreviewModalImg = document.getElementById('btn-preview-modal-img');
    const btnPreviewModalCopy = document.getElementById('btn-preview-modal-copy');

    function openPreviewModal(customData = null, customImages = null, customInfo = null) {
        if (!previewSheetModal || !previewSheetContainer) return;
        const sheet = buildPrintableSheet(customData, customImages, customInfo);
        previewSheetContainer.innerHTML = '';
        const clone = sheet.cloneNode(true);
        clone.id = 'previewed-sheet-clone';
        clone.style.display = 'block';
        previewSheetContainer.appendChild(clone);

        if (window.renderMathInElement) {
            try {
                window.renderMathInElement(previewSheetContainer, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '\\[', right: '\\]', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false}
                    ],
                    throwOnError: false
                });
            } catch (_) {}
        }

        previewSheetModal.classList.remove('hidden');
    }

    if (btnPreviewSheet) {
        btnPreviewSheet.addEventListener('click', () => {
            if (!currentGradingData) return;
            openPreviewModal();
        });
    }

    if (btnPreviewModalClose) {
        btnPreviewModalClose.addEventListener('click', () => {
            previewSheetModal.classList.add('hidden');
        });
    }

    if (btnPreviewModalPrint) {
        btnPreviewModalPrint.addEventListener('click', () => {
            buildPrintableSheet();
            window.print();
        });
    }

    if (btnPreviewModalPdf) {
        btnPreviewModalPdf.addEventListener('click', () => {
            exportSinglePdf();
        });
    }

    if (btnPreviewModalImg) {
        btnPreviewModalImg.addEventListener('click', () => {
            exportSingleImage();
        });
    }

    if (btnPreviewModalCopy) {
        btnPreviewModalCopy.addEventListener('click', () => {
            copySingleImageToClipboard();
        });
    }

    // --- PRINT ACTION ---
    const btnPrintSheet = document.getElementById('btn-print-sheet');
    if (btnPrintSheet) {
        btnPrintSheet.addEventListener('click', () => {
            buildPrintableSheet();
            window.print();
        });
    }

    // --- EXPORT PDF ACTION ---
    const btnExportPdf = document.getElementById('btn-export-pdf');
    if (btnExportPdf) {
        btnExportPdf.addEventListener('click', async () => {
            if (!currentGradingData) return;
            btnExportPdf.disabled = true;
            btnExportPdf.innerText = '⏳ Đang tạo PDF...';
            try {
                await exportSinglePdf();
            } catch (err) {
                console.error('PDF error:', err);
                showToast('Lỗi khi tạo PDF: ' + err.message, 'error');
            } finally {
                btnExportPdf.disabled = false;
                btnExportPdf.innerText = '📄 Xuất PDF';
            }
        });
    }

    // --- EXPORT IMAGE (PNG) ACTION ---
    const btnExportImg = document.getElementById('btn-export-img');
    if (btnExportImg) {
        btnExportImg.addEventListener('click', async () => {
            if (!currentGradingData) return;
            btnExportImg.disabled = true;
            btnExportImg.innerText = '⏳ Đang tạo ảnh...';
            try {
                await exportSingleImage();
            } catch (err) {
                console.error('Image error:', err);
                showToast('Lỗi khi tạo file ảnh: ' + err.message, 'error');
            } finally {
                btnExportImg.disabled = false;
                btnExportImg.innerText = '🖼️ Xuất ảnh';
            }
        });
    }

    // --- COPY SHEET IMAGE TO CLIPBOARD ACTION ---
    const btnCopySheetImg = document.getElementById('btn-copy-sheet-img');
    if (btnCopySheetImg) {
        btnCopySheetImg.addEventListener('click', async () => {
            if (!currentGradingData) return;
            btnCopySheetImg.disabled = true;
            btnCopySheetImg.innerText = '⏳ Đang sao chép...';
            try {
                await copySingleImageToClipboard();
            } catch (err) {
                console.error('Copy error:', err);
            } finally {
                btnCopySheetImg.disabled = false;
                btnCopySheetImg.innerText = '📋 Sao chép ảnh';
            }
        });
    }

    // --- EXPORT WORD (.DOC) ACTION ---
    const btnExportWord = document.getElementById('btn-export-word');
    if (btnExportWord) {
        btnExportWord.addEventListener('click', () => {
            if (!currentGradingData) return;
            const sheet = buildPrintableSheet();
            const studentName = document.getElementById('info-student-name')?.value || 'HocSinh';
            const lessonTitle = document.getElementById('info-lesson-title')?.value || 'BaiToan';
            const fileName = sanitizeFileName(`Ket_qua_cham_${studentName}_${lessonTitle}`) + '.doc';

            const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head>
                <meta charset='utf-8'>
                <title>Phiếu kết quả chấm bài</title>
                <style>
                    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1e293b; line-height: 1.5; margin: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                    td, th { padding: 8px 12px; border: 1px solid #cbd5e1; font-size: 10pt; }
                    .ps-header { border-bottom: 2pt solid #2563eb; padding-bottom: 8px; margin-bottom: 12px; }
                    .ps-logo { font-size: 16pt; font-weight: bold; color: #2563eb; }
                    .ps-title { font-size: 14pt; font-weight: bold; text-align: right; color: #1e293b; }
                    .ps-score-row { background: #eff6ff; border: 1pt solid #bfdbfe; padding: 10px; margin-bottom: 12px; }
                    .ps-total-score-badge { font-size: 18pt; font-weight: bold; color: #1d4ed8; }
                    .ps-step-box { background: #f8fafc; border: 1pt solid #e2e8f0; padding: 8px; margin-bottom: 8px; }
                    .ps-step-title { font-weight: bold; font-size: 10pt; }
                    .ps-math-row { font-size: 10.5pt; margin: 4px 0; }
                    .ps-correction { background: #fff1f2; border-left: 3pt solid #f43f5e; padding: 6px 10px; color: #9f1239; margin-top: 4px; }
                    .ps-general-comment { background: #f8fafc; border: 1pt solid #cbd5e1; padding: 10px; margin-top: 15px; }
                    img { max-width: 100%; height: auto; }
                </style>
            </head>
            <body>`;
            const footer = "</body></html>";
            const sourceHTML = header + sheet.innerHTML + footer;

            const blob = new Blob(['\ufeff', sourceHTML], { type: 'application/msword;charset=utf-8' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            link.click();
            URL.revokeObjectURL(link.href);
        });
    }

    // --- REGRADE CURRENT IMAGE ACTION ---
    const btnRegradeCurrent = document.getElementById('btn-regrade-current');
    if (btnRegradeCurrent) {
        btnRegradeCurrent.addEventListener('click', () => {
            sectionResult.classList.add('hidden');
            sectionUpload.classList.remove('hidden');
            if (uploadedPages.length > 0) {
                btnGrade.click();
            }
        });
    }

    btnGrade.addEventListener('click', async () => {
        if (!uploadedPages || uploadedPages.length === 0) {
            showToast('Vui lòng chọn ít nhất một hình ảnh bài làm.', 'warning');
            return;
        }

        btnGrade.classList.remove('pulse-glow');
        modal.classList.remove('hidden');
        modalFinalMsg.classList.add('hidden');

        // Khởi động mảng tiến trình chuẩn 8 bước
        const loadingSteps = [
            "Đang chuẩn bị ảnh...",
            "Đang tối ưu ảnh...",
            "Đang gửi bài làm...",
            "Đang đọc đề...",
            "Đang tạo đáp án chuẩn...",
            "Đang phân tích bài làm...",
            "Đang đối chiếu từng bước...",
            "Đang hoàn tất..."
        ];
        let stepIdx = 0;
        loadingText.innerText = loadingSteps[0];

        const stepInterval = setInterval(() => {
            stepIdx++;
            if (stepIdx < loadingSteps.length) {
                loadingText.innerText = loadingSteps[stepIdx];
            } else {
                clearInterval(stepInterval);
            }
        }, 1200);

        try {
            // Tối ưu hóa ảnh thích ứng cho từng trang
            loadingText.innerText = loadingSteps[1]; // Đang tối ưu ảnh...
            for (let i = 0; i < uploadedPages.length; i++) {
                await optimizeImageForAI(uploadedPages[i]);
            }

            loadingText.innerText = loadingSteps[2]; // Đang gửi bài làm...
            const formData = new FormData();
            // Gửi lớp học sang backend để khóa phạm vi chương trình khi chấm và sinh bài tự luyện.
            const studentClassForGrade = (document.getElementById('info-student-class')?.value || '').trim();
            if (studentClassForGrade) formData.append('studentClass', studentClassForGrade);
            for (let i = 0; i < uploadedPages.length; i++) {
                const page = uploadedPages[i];
                const blob = page.optimizedBlob || await optimizeImageForAI(page);
                formData.append('files', blob, page.name || `page_${i + 1}.jpg`);
            }
            // Fetch API gọi tới Backend Gemini với bộ đếm thời gian 90 giây
            const controller = new AbortController();
            const timeoutTimer = setTimeout(() => controller.abort(), 90000);

            const uploadUrl = `${getApiBaseUrl()}/api/v1/upload`;
            console.log(`[API Request] Gửi yêu cầu chấm bài tới: ${uploadUrl}`);

            let response;
            try {
                response = await fetch(uploadUrl, {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutTimer);
            }

            const contentType = response.headers.get('content-type') || '';
            console.log(`[API Response] URL: ${uploadUrl} | Status: ${response.status} ${response.statusText} | Content-Type: ${contentType}`);

            let data;
            if (contentType.includes('application/json')) {
                data = await response.json();
            } else {
                const rawText = await response.text();
                console.error('[API Response Error] Máy chủ phản hồi định dạng không phải JSON:', {
                    requestUrl: uploadUrl,
                    responseStatus: response.status,
                    statusText: response.statusText,
                    contentType: contentType,
                    responseText: rawText
                });

                if (response.status === 504 || response.status === 502) {
                    throw new Error('Máy chủ AI đang phản hồi lâu hoặc tạm thời quá tải (Gateway Timeout 502/504). Vui lòng nhấn "Đóng & Thử lại".');
                }
                if (response.status === 413) {
                    throw new Error('Dung lượng ảnh bài làm vượt quá giới hạn cho phép. Vui lòng chọn ảnh nhẹ hơn.');
                }
                if (response.status === 404) {
                    throw new Error('Không tìm thấy endpoint API /api/v1/upload trên máy chủ.');
                }
                throw new Error(`Máy chủ phản hồi trạng thái ${response.status} (${contentType || 'non-JSON'}). Vui lòng thử lại.`);
            }

            if (!response.ok) {
                console.error('[API Response Error] Máy chủ trả về mã lỗi HTTP:', response.status, data);
                throw new Error(data.message || `Lỗi máy chủ (${response.status})`);
            }

            clearInterval(stepInterval);

            if (data.success) {
                loadingText.innerText = "Hoàn tất.";

                // Lưu ảnh hiển thị theo trang
                currentGradingImages = uploadedPages.map((p, idx) => ({
                    pageIndex: idx,
                    dataUrl: p.displayDataUrl,
                    originalDataUrl: p.originalDataUrl,
                    name: p.name
                }));
                selectedFileUrl = currentGradingImages[0]?.dataUrl;

                // Tự động lưu kết quả vào IndexedDB (Lịch sử chấm bài)
                const studentName = document.getElementById('info-student-name')?.value || 'Học sinh';
                const studentClass = document.getElementById('info-student-class')?.value || 'THCS';
                const lessonTitle = document.getElementById('info-lesson-title')?.value || 'Bài kiểm tra Toán';
                const dateDisplay = document.getElementById('info-grading-date')?.value || new Date().toLocaleDateString('vi-VN');

                const historyItem = {
                    id: 'grade_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    createdAt: new Date().toISOString(),
                    dateDisplay: dateDisplay,
                    title: lessonTitle,
                    studentName: studentName,
                    studentClass: studentClass,
                    score: data.score !== undefined ? data.score : 0,
                    maxScore: data.maxScore || 10,
                    result: data.questions?.[0]?.result || (data.score >= 5 ? 'Đạt' : 'Chưa đạt'),
                    summary: data.summary || '',
                    images: currentGradingImages,
                    gradingData: data
                };
                currentGradingSessionId = historyItem.id;

                try {
                    await MatsudaDB.saveHistory(historyItem);
                    await updateHistoryBadge();
                } catch (dbErr) {
                    console.warn('Lỗi lưu lịch sử chấm bài:', dbErr);
                }

                setTimeout(() => {
                    modal.classList.add('hidden');
                    sectionUpload.classList.add('hidden');
                    sectionResult.classList.remove('hidden');
                    renderResult(data);
                }, 600);
            } else {
                throw new Error(data.message || "Lỗi xử lý AI");
            }
        } catch (error) {
            clearInterval(stepInterval);
            let displayMsg = error.message || 'Đã có lỗi xảy ra.';
            if (error.name === 'AbortError') {
                displayMsg = 'Quá thời gian chờ phản hồi từ AI (sau 90 giây). Vui lòng kiểm tra lại mạng và nhấn Thử lại.';
            } else if (displayMsg === 'Failed to fetch' || displayMsg.includes('Failed to fetch')) {
                displayMsg = 'Không thể kết nối đến máy chủ xử lý AI (Failed to fetch). Vui lòng kiểm tra kết nối mạng và nhấn Thử lại.';
            } else if (displayMsg.includes('Unexpected token') || displayMsg.includes('not valid JSON')) {
                displayMsg = 'Máy chủ phản hồi không đúng định dạng. Vui lòng nhấn Thử lại.';
            }

            loadingText.innerHTML = `<span style="color: var(--color-danger); font-size: 14px; line-height: 1.5; display: inline-block;">❌ ${escapeHtml(displayMsg)}</span>`;
            modalFinalMsg.innerHTML = `<button id="btn-close-modal" class="btn btn-primary mt-4 w-100">Đóng & Thử lại</button>`;
            modalFinalMsg.classList.remove('hidden');
            document.getElementById('btn-close-modal').addEventListener('click', () => {
                modal.classList.add('hidden');
                btnGrade.disabled = false;
                btnGrade.classList.remove('disabled-btn');
                btnGrade.style.opacity = '1';
                btnGrade.style.cursor = 'pointer';
            });
        }
    });

    btnResetMain.addEventListener('click', () => {
        sectionResult.classList.add('hidden');
        sectionUpload.classList.remove('hidden');
        resetUploadArea();
    });

    // ========================================================
    // BATCH GRADING SUITE (CHẤM BÀI HÀNG LOẠT CHO CẢ LỚP)
    // ========================================================
    const tabBtnSingle = document.getElementById('tab-btn-single');
    const tabBtnBatch = document.getElementById('tab-btn-batch');
    const batchSection = document.getElementById('batch-section');
    const batchFileInput = document.getElementById('batch-file-input');
    const batchEmptyFileInput = document.getElementById('batch-empty-file-input');
    const btnBatchSampleDemo = document.getElementById('btn-batch-sample-demo');
    const btnBatchSampleDemoEmpty = document.getElementById('btn-batch-sample-demo-empty');
    const btnBatchClearAll = document.getElementById('btn-batch-clear-all');
    const btnBatchStart = document.getElementById('btn-batch-start');
    const btnBatchStop = document.getElementById('btn-batch-stop');
    const btnBatchRetryFailed = document.getElementById('btn-batch-retry-failed');
    const btnBatchExportExcel = document.getElementById('btn-batch-export-excel');
    const btnBatchExportZipPdf = document.getElementById('btn-batch-export-zip-pdf');
    const btnBatchExportZipImg = document.getElementById('btn-batch-export-zip-img');
    const btnBatchExportAllPdf = document.getElementById('btn-batch-export-all-pdf');
    const btnBatchExportAllImg = document.getElementById('btn-batch-export-all-img');

    const batchProgressCard = document.getElementById('batch-progress-card');
    const batchProgressBarFill = document.getElementById('batch-progress-bar-fill');
    const batchProgressStatusText = document.getElementById('batch-progress-status-text');
    const batchProgressCounter = document.getElementById('batch-progress-counter');
    const batchAnalyticsCard = document.getElementById('batch-analytics-card');
    const batchEmptyState = document.getElementById('batch-empty-state');
    const batchTableWrapper = document.getElementById('batch-table-wrapper');
    const batchStudentsTbody = document.getElementById('batch-students-tbody');
    const batchTotalStudentsLabel = document.getElementById('batch-total-students-label');

    // KPI & Analytics elements
    const batchKpiAvg = document.getElementById('batch-kpi-avg');
    const batchKpiMax = document.getElementById('batch-kpi-max');
    const batchKpiMaxStudent = document.getElementById('batch-kpi-max-student');
    const batchKpiMin = document.getElementById('batch-kpi-min');
    const batchKpiMinStudent = document.getElementById('batch-kpi-min-student');
    const batchKpiPassRate = document.getElementById('batch-kpi-pass-rate');
    const batchKpiPassCount = document.getElementById('batch-kpi-pass-count');

    const distBarExcellent = document.getElementById('dist-bar-excellent');
    const distBarGood = document.getElementById('dist-bar-good');
    const distBarFair = document.getElementById('dist-bar-fair');
    const distBarPass = document.getElementById('dist-bar-pass');
    const distBarFail = document.getElementById('dist-bar-fail');
    const cntExcellent = document.getElementById('cnt-excellent');
    const cntGood = document.getElementById('cnt-good');
    const cntFair = document.getElementById('cnt-fair');
    const cntPass = document.getElementById('cnt-pass');
    const cntFail = document.getElementById('cnt-fail');

    // Batch Edit Modal elements
    const batchEditStudentModal = document.getElementById('batch-edit-student-modal');
    const batchEditStudentId = document.getElementById('batch-edit-student-id');
    const batchEditStudentName = document.getElementById('batch-edit-student-name');
    const batchEditStudentClass = document.getElementById('batch-edit-student-class');
    const batchEditStudentScore = document.getElementById('batch-edit-student-score');
    const batchEditStudentSummary = document.getElementById('batch-edit-student-summary');
    const btnCloseBatchEdit = document.getElementById('btn-close-batch-edit');
    const btnCancelBatchEdit = document.getElementById('btn-cancel-batch-edit');
    const btnSaveBatchEdit = document.getElementById('btn-save-batch-edit');

    // State for batch grading
    let batchStudents = [];
    let isBatchGradingRunning = false;
    let batchCancelRequested = false;

    // --- TAB SWITCHING: TỪNG BÀI vs HÀNG LOẠT ---
    if (tabBtnSingle && tabBtnBatch) {
        tabBtnSingle.addEventListener('click', () => {
            tabBtnSingle.classList.add('active');
            tabBtnBatch.classList.remove('active');
            batchSection.classList.add('hidden');
            if (currentGradingData) {
                sectionResult.classList.remove('hidden');
                sectionUpload.classList.add('hidden');
            } else {
                sectionUpload.classList.remove('hidden');
                sectionResult.classList.add('hidden');
            }
        });

        tabBtnBatch.addEventListener('click', () => {
            tabBtnBatch.classList.add('active');
            tabBtnSingle.classList.remove('active');
            sectionUpload.classList.add('hidden');
            sectionResult.classList.add('hidden');
            batchSection.classList.remove('hidden');
            renderBatchUI();
        });
    }

    // --- DRAW DEMO NOTEBOOK PAGE CANVAS ---
    function drawDemoStudentNotebook(studentName, className, dateStr, title, mathSteps) {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 1600;
        const ctx = canvas.getContext('2d');

        // Nền trang vở ô ly học sinh
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Kẻ ô ly xanh ngọc nhạt
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 1;
        for (let x = 40; x < canvas.width; x += 30) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 40; y < canvas.height; y += 30) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        // Đường lề đỏ kẻ dọc
        ctx.strokeStyle = '#fca5a5';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(140, 0);
        ctx.lineTo(140, canvas.height);
        ctx.stroke();

        // Tiêu đề & Thông tin học sinh (màu mực xanh học trò)
        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
        ctx.fillText(title, 260, 90);

        ctx.font = 'italic 20px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#1e40af';
        ctx.fillText(`Họ và tên: ${studentName} - Lớp: ${className}`, 170, 140);
        ctx.fillText(`Ngày: ${dateStr}`, 820, 140);

        // Kẻ ngang phân cách
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(170, 160);
        ctx.lineTo(1050, 160);
        ctx.stroke();

        // Vẽ từng dòng bài làm
        let yPos = 210;
        mathSteps.forEach((line) => {
            if (line.isHeading) {
                ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
                ctx.fillStyle = '#0f172a';
            } else {
                ctx.font = 'normal 21px "Segoe UI", Arial, sans-serif';
                ctx.fillStyle = '#1d4ed8';
            }
            ctx.fillText(line.text, line.x || 170, yPos);
            yPos += line.gap || 45;
        });

        return canvas.toDataURL('image/jpeg', 0.92);
    }

    // --- LOAD BATCH SAMPLE DEMO (3 HỌC SINH MẪU) ---
    function loadBatchSampleDemo() {
        const todayStr = new Date().toLocaleDateString('vi-VN');

        // Học sinh 1: Nguyễn Văn An - 8A1 (Đại số 8: Hằng đẳng thức & Phân thức)
        const anDataUrl = drawDemoStudentNotebook(
            'Nguyễn Văn An',
            '8A1',
            todayStr,
            'BÀI KIỂM TRA ĐẠI SỐ 8 - TIẾT 15',
            [
                { text: 'Câu 1 (5,0 điểm): Phân tích đa thức sau thành nhân tử: A = x² - 4x + 4 - y²', isHeading: true, gap: 40 },
                { text: 'Bài làm:', gap: 40 },
                { text: 'Ta có: A = (x² - 4x + 4) - y²', x: 200, gap: 40 },
                { text: '        = (x - 2)² - y²', x: 200, gap: 40 },
                { text: '        = (x - 2 - y)(x - 2 + y)', x: 200, gap: 50 },
                { text: 'Câu 2 (5,0 điểm): Rút gọn phân thức: B = (x² - 9)/(2x + 6)', isHeading: true, gap: 40 },
                { text: 'Bài làm:', gap: 40 },
                { text: 'ĐKXĐ: 2x + 6 ≠ 0 ⇔ 2x ≠ -6 ⇔ x ≠ -3', x: 200, gap: 40 },
                { text: 'Ta có: B = (x - 3)(x + 3) / [2(x + 3)]', x: 200, gap: 40 },
                { text: '        = (x - 3) / 2', x: 200, gap: 40 },
                { text: 'Vậy B = (x - 3)/2 với x ≠ -3.', x: 200, gap: 40 }
            ]
        );

        // Học sinh 2: Trần Thị Bình - 8A1 (Đại số 8: Giải phương trình)
        const binhDataUrl = drawDemoStudentNotebook(
            'Trần Thị Bình',
            '8A1',
            todayStr,
            'BÀI KIỂM TRA ĐẠI SỐ 8 - TIẾT 15',
            [
                { text: 'Câu 1 (5,0 điểm): Giải phương trình: 2(x - 3) + 5 = 3x - 1', isHeading: true, gap: 40 },
                { text: 'Bài làm:', gap: 40 },
                { text: 'Ta có: 2x - 6 + 5 = 3x - 1', x: 200, gap: 40 },
                { text: '   ⇔ 2x - 1 = 3x - 1', x: 200, gap: 40 },
                { text: '   ⇔ 2x - 3x = -1 + 1', x: 200, gap: 40 },
                { text: '   ⇔ -x = 0 ⇔ x = 0', x: 200, gap: 40 },
                { text: 'Vậy tập nghiệm của phương trình là S = {0}.', x: 200, gap: 50 },
                { text: 'Câu 2 (5,0 điểm): Tìm x biết: (x + 1)² - (x - 2)(x + 2) = 7', isHeading: true, gap: 40 },
                { text: 'Bài làm:', gap: 40 },
                { text: 'Ta có: (x² + 2x + 1) - (x² - 4) = 7', x: 200, gap: 40 },
                { text: '   ⇔ x² + 2x + 1 - x² + 4 = 7', x: 200, gap: 40 },
                { text: '   ⇔ 2x + 5 = 7 ⇔ 2x = 2 ⇔ x = 1', x: 200, gap: 40 },
                { text: 'Vậy x = 1.', x: 200, gap: 40 }
            ]
        );

        // Học sinh 3: Lê Hoàng Châu - 8A1 (Hình học 8: Định lý Pytago & Tam giác vuông)
        const chauDataUrl = drawDemoStudentNotebook(
            'Lê Hoàng Châu',
            '8A1',
            todayStr,
            'BÀI KIỂM TRA HÌNH HỌC 8 - TIẾT 15',
            [
                { text: 'Câu 1 (10,0 điểm): Cho tam giác ABC vuông tại A có AB = 6cm, AC = 8cm.', isHeading: true, gap: 35 },
                { text: 'a) Tính độ dài cạnh huyền BC.', isHeading: true, gap: 40 },
                { text: 'b) Kẻ đường cao AH (H ∈ BC). Tính diện tích tam giác ABC.', isHeading: true, gap: 40 },
                { text: 'Bài làm:', gap: 40 },
                { text: 'a) Áp dụng định lý Pytago vào tam giác ABC vuông tại A:', x: 200, gap: 40 },
                { text: '   Ta có: BC² = AB² + AC² = 6² + 8² = 36 + 64 = 100', x: 200, gap: 40 },
                { text: '   ⇒ BC = √100 = 10 (cm).', x: 200, gap: 40 },
                { text: 'b) Diện tích tam giác vuông ABC là:', x: 200, gap: 40 },
                { text: '   S_ABC = (1/2) · AB · AC = (1/2) · 6 · 8 = 24 (cm²).', x: 200, gap: 40 },
                { text: 'Vậy BC = 10 cm và diện tích tam giác ABC là 24 cm².', x: 200, gap: 40 }
            ]
        );

        batchStudents = [
            {
                id: 'student_demo_1',
                name: 'Nguyễn Văn An',
                className: '8A1',
                lessonTitle: 'Kiểm tra Đại số 8',
                date: todayStr,
                pages: [{ name: 'NguyenVanAn_Bai1.jpg', dataUrl: anDataUrl }],
                status: 'pending',
                score: null,
                maxScore: 10,
                verdict: 'Chờ chấm',
                summary: '',
                gradingData: null,
                errorMsg: null,
                isTeacherEdited: false
            },
            {
                id: 'student_demo_2',
                name: 'Trần Thị Bình',
                className: '8A1',
                lessonTitle: 'Kiểm tra Đại số 8',
                date: todayStr,
                pages: [{ name: 'TranThiBinh_Bai1.jpg', dataUrl: binhDataUrl }],
                status: 'pending',
                score: null,
                maxScore: 10,
                verdict: 'Chờ chấm',
                summary: '',
                gradingData: null,
                errorMsg: null,
                isTeacherEdited: false
            },
            {
                id: 'student_demo_3',
                name: 'Lê Hoàng Châu',
                className: '8A1',
                lessonTitle: 'Kiểm tra Hình học 8',
                date: todayStr,
                pages: [{ name: 'LeHoangChau_Bai1.jpg', dataUrl: chauDataUrl }],
                status: 'pending',
                score: null,
                maxScore: 10,
                verdict: 'Chờ chấm',
                summary: '',
                gradingData: null,
                errorMsg: null,
                isTeacherEdited: false
            }
        ];

        renderBatchUI();
        showToast('Đã nạp 3 bài làm mẫu thử nghiệm môn Toán cho cả lớp! Nhấn "Bắt đầu chấm tất cả" để chấm tự động.', 'success');
    }

    if (btnBatchSampleDemo) {
        btnBatchSampleDemo.addEventListener('click', loadBatchSampleDemo);
    }
    if (btnBatchSampleDemoEmpty) {
        btnBatchSampleDemoEmpty.addEventListener('click', loadBatchSampleDemo);
    }

    // --- PROCESS BATCH UPLOADED FILES (ẢNH & TỆP NÉN .ZIP) ---
    async function handleBatchFilesSelected(files) {
        if (!files || files.length === 0) return;

        showToast(`Đang xử lý ${files.length} tệp tải lên...`, 'info');

        const fileArray = Array.from(files);
        const grouped = {};
        const validImgExts = ['.jpg', '.jpeg', '.png', '.webp', '.jfif', '.bmp', '.heic', '.heif'];
        
        function isImageName(name) {
            const lower = name.toLowerCase();
            return validImgExts.some(ext => lower.endsWith(ext));
        }

        function getMime(name) {
            const lower = name.toLowerCase();
            if (lower.endsWith('.png')) return 'image/png';
            if (lower.endsWith('.webp')) return 'image/webp';
            if (lower.endsWith('.bmp')) return 'image/bmp';
            if (lower.endsWith('.gif')) return 'image/gif';
            return 'image/jpeg';
        }

        for (const file of fileArray) {
            const isZip = file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip');
            
            if (isZip && window.JSZip) {
                showToast(`Đang giải nén tệp ZIP "${file.name}"...`, 'info');
                try {
                    const zip = await window.JSZip.loadAsync(file);
                    const entries = [];
                    zip.forEach((relPath, entry) => {
                        if (!entry.dir && !relPath.startsWith('__MACOSX') && !relPath.startsWith('.') && isImageName(relPath)) {
                            entries.push({ path: relPath, entry });
                        }
                    });

                    if (entries.length === 0) {
                        showToast(`Tệp ZIP "${file.name}" không chứa ảnh bài làm hợp lệ (.jpg, .png, .webp...).`, 'warning');
                        continue;
                    }

                    for (const item of entries) {
                        const parts = item.path.split('/').filter(Boolean);
                        let studentName = '';
                        let fileName = parts[parts.length - 1];

                        if (parts.length > 1 && parts[0] && parts[0] !== '.' && parts[0] !== '__MACOSX') {
                            // Cấu trúc thư mục: "Nguyen_Van_A/trang_1.jpg"
                            studentName = parts[0].replace(/[-_]+/g, ' ').trim();
                        } else {
                            // Tệp phẳng trong ZIP: "Nguyen_Van_A_Trang1.jpg"
                            let raw = fileName.replace(/\.[^/.]+$/, '');
                            raw = raw.replace(/[-_]+/g, ' ').trim();
                            raw = raw.replace(/(trang|page|bai|cau)\s*\d+/gi, '').trim();
                            studentName = raw;
                        }

                        if (!studentName || studentName.length < 2) {
                            studentName = `Học sinh ${Object.keys(grouped).length + batchStudents.length + 1}`;
                        }

                        const base64 = await item.entry.async('base64');
                        const dataUrl = `data:${getMime(fileName)};base64,${base64}`;

                        if (!grouped[studentName]) grouped[studentName] = [];
                        grouped[studentName].push({
                            name: fileName,
                            dataUrl: dataUrl
                        });
                    }

                    showToast(`Đã giải nén ${entries.length} ảnh từ tệp ZIP "${file.name}"!`, 'success');
                } catch (zipErr) {
                    console.error('Lỗi khi giải nén tệp ZIP:', zipErr);
                    showToast(`Lỗi khi giải nén file ZIP ${file.name}: ${zipErr.message}`, 'error');
                }
            } else {
                // Tệp ảnh thông thường
                const dataUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.readAsDataURL(file);
                });

                // Tự động phân loại tên học sinh từ tên file
                let rawName = file.name.replace(/\.[^/.]+$/, ''); // bỏ extension
                rawName = rawName.replace(/[-_]+/g, ' ').trim();
                rawName = rawName.replace(/(trang|page|bai|cau)\s*\d+/gi, '').trim();
                if (!rawName || rawName.length < 2) {
                    rawName = `Học sinh ${Object.keys(grouped).length + batchStudents.length + 1}`;
                }

                if (!grouped[rawName]) {
                    grouped[rawName] = [];
                }
                grouped[rawName].push({
                    name: file.name,
                    dataUrl: dataUrl,
                    file: file
                });
            }
        }

        const todayStr = new Date().toLocaleDateString('vi-VN');
        Object.keys(grouped).forEach((sName) => {
            batchStudents.push({
                id: 'student_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                name: sName,
                className: '8A',
                lessonTitle: 'Bài kiểm tra Toán',
                date: todayStr,
                pages: grouped[sName],
                status: 'pending',
                score: null,
                maxScore: 10,
                verdict: 'Chờ chấm',
                summary: '',
                gradingData: null,
                errorMsg: null,
                isTeacherEdited: false
            });
        });

        renderBatchUI();
        showToast(`Đã thêm ${Object.keys(grouped).length} học sinh vào danh sách chấm hàng loạt!`, 'success');
    }

    if (batchFileInput) {
        batchFileInput.addEventListener('change', (e) => {
            handleBatchFilesSelected(e.target.files);
            e.target.value = '';
        });
    }
    if (batchEmptyFileInput) {
        batchEmptyFileInput.addEventListener('change', (e) => {
            handleBatchFilesSelected(e.target.files);
            e.target.value = '';
        });
    }

    // --- CLEAR BATCH ALL ---
    if (btnBatchClearAll) {
        btnBatchClearAll.addEventListener('click', () => {
            if (batchStudents.length === 0) return;
            if (isBatchGradingRunning) {
                showToast('Hệ thống đang chấm bài, vui lòng bấm Tạm dừng trước khi xóa.', 'warning');
                return;
            }
            batchStudents = [];
            renderBatchUI();
            showToast('Đã xóa toàn bộ danh sách lớp.', 'info');
        });
    }

    // --- RENDER BATCH UI: TABLE & ANALYTICS ---
    function renderBatchUI() {
        if (!batchStudentsTbody) return;

        if (batchStudents.length === 0) {
            batchEmptyState.classList.remove('hidden');
            batchTableWrapper.classList.add('hidden');
            batchProgressCard.classList.add('hidden');
            batchAnalyticsCard.classList.add('hidden');
            batchTotalStudentsLabel.innerText = 'Chưa có bài làm nào trong danh sách';
            return;
        }

        batchEmptyState.classList.add('hidden');
        batchTableWrapper.classList.remove('hidden');
        batchProgressCard.classList.remove('hidden');
        batchAnalyticsCard.classList.remove('hidden');

        const totalStudents = batchStudents.length;
        const doneStudents = batchStudents.filter(s => s.status === 'done').length;
        const errorStudents = batchStudents.filter(s => s.status === 'error').length;
        const pendingStudents = batchStudents.filter(s => s.status === 'pending').length;

        batchTotalStudentsLabel.innerText = `Tổng cộng: ${totalStudents} học sinh • Đã chấm: ${doneStudents} • Chờ: ${pendingStudents}${errorStudents > 0 ? ` • Lỗi: ${errorStudents}` : ''}`;

        // Render table rows
        let rowsHtml = '';
        batchStudents.forEach((student, idx) => {
            let statusBadge = '<span class="batch-badge batch-badge-pending">⏳ Chờ chấm</span>';
            if (student.status === 'processing') {
                statusBadge = '<span class="batch-badge batch-badge-processing">⚡ Đang chấm...</span>';
            } else if (student.status === 'done') {
                statusBadge = '<span class="batch-badge batch-badge-done">✅ Đã chấm</span>';
            } else if (student.status === 'error') {
                statusBadge = `<span class="batch-badge batch-badge-error" title="${escapeHtml(student.errorMsg || 'Lỗi')}">❌ Lỗi chấm</span>`;
            }

            let scoreText = '-';
            let verdictBadge = '<span style="color: #94a3b8; font-size: 12px;">-</span>';
            if (student.status === 'done' && student.score !== null) {
                const tier = getScoreTier(student.score);
                scoreText = `<strong style="font-size: 15px; color: ${tier.color};">${student.score.toFixed(1)}</strong><span style="font-size: 11px; color: #64748b;"> / 10</span>`;
                verdictBadge = `<span style="background: ${tier.bg}; color: ${tier.color}; border: 1px solid ${tier.border}; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px;">${tier.badge}</span>`;
            }

            const pagesCount = student.pages ? student.pages.length : 1;

            rowsHtml += `
                <tr id="batch-row-${student.id}">
                    <td style="text-align: center; color: #64748b; font-weight: 600;">${idx + 1}</td>
                    <td>
                        <strong style="color: #1e293b; font-size: 14px;">${escapeHtml(student.name)}</strong>
                        ${student.isTeacherEdited ? ' <span title="Đã sửa bởi giáo viên" style="font-size: 12px;">✏️</span>' : ''}
                        <div style="font-size: 11.5px; color: #64748b;">${escapeHtml(student.lessonTitle || 'Bài kiểm tra')}</div>
                    </td>
                    <td>
                        <span style="background: #f1f5f9; padding: 2px 7px; border-radius: 4px; font-size: 12px; font-weight: 600; color: #475569;">${escapeHtml(student.className || '8A')}</span>
                    </td>
                    <td style="text-align: center;">
                        <span style="font-size: 12px; color: #475569;">📄 ${pagesCount} trang</span>
                    </td>
                    <td style="text-align: center;">
                        ${scoreText}
                    </td>
                    <td style="text-align: center;">
                        ${verdictBadge}
                    </td>
                    <td style="text-align: center;">
                        ${statusBadge}
                    </td>
                    <td style="text-align: right;">
                        <div style="display: inline-flex; gap: 6px; align-items: center;">
                            ${student.status === 'done' ? `
                                <button type="button" class="btn btn-outline btn-sm btn-batch-zalo" data-id="${student.id}" title="Soạn & sao chép tin nhắn Zalo gửi phụ huynh em ${escapeHtml(student.name)}" style="background: #e0f2fe; color: #0284c7; border-color: #7dd3fc; font-weight: 700;">
                                    💬 Zalo
                                </button>
                                <button type="button" class="btn btn-outline btn-sm btn-batch-view" data-id="${student.id}" title="Xem chi tiết phiếu chấm bài">
                                    👁️ Xem
                                </button>
                                <button type="button" class="btn btn-primary btn-sm btn-batch-pdf" data-id="${student.id}" title="Tải phiếu PDF">
                                    📄 PDF
                                </button>
                                <button type="button" class="btn btn-outline btn-sm btn-batch-img" data-id="${student.id}" title="Tải ảnh phiếu">
                                    🖼️ Ảnh
                                </button>
                            ` : ''}
                            <button type="button" class="btn btn-secondary btn-sm btn-batch-edit" data-id="${student.id}" title="Chỉnh sửa thông tin / điểm">
                                ✏️
                            </button>
                            <button type="button" class="btn btn-outline btn-sm text-danger btn-batch-delete" data-id="${student.id}" title="Xóa học sinh này">
                                🗑
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        batchStudentsTbody.innerHTML = rowsHtml;

        // Attach action handlers for each row
        attachBatchRowActions();

        // Update progress bar
        updateBatchProgress(doneStudents, totalStudents);

        // Update analytics dashboard
        updateBatchAnalytics();

        // Control buttons state
        if (errorStudents > 0) {
            btnBatchRetryFailed.classList.remove('hidden');
        } else {
            btnBatchRetryFailed.classList.add('hidden');
        }
    }

    function updateBatchProgress(done, total) {
        if (!batchProgressBarFill || !batchProgressCounter) return;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        batchProgressBarFill.style.width = `${pct}%`;
        batchProgressCounter.innerText = `${done} / ${total}`;

        if (isBatchGradingRunning) {
            btnBatchStart.classList.add('hidden');
            btnBatchStop.classList.remove('hidden');
        } else {
            btnBatchStart.classList.remove('hidden');
            btnBatchStop.classList.add('hidden');
            if (done === total && total > 0) {
                batchProgressStatusText.innerText = 'Đã hoàn thành chấm toàn bộ lớp! 🎉';
            } else if (done > 0) {
                batchProgressStatusText.innerText = `Đã chấm ${done}/${total} bài. Sẵn sàng tiếp tục.`;
            } else {
                batchProgressStatusText.innerText = 'Sẵn sàng bắt đầu chấm bài.';
            }
        }
    }

    // --- UPDATE CLASS GRADEBOOK ANALYTICS ---
    function updateBatchAnalytics() {
        const doneStudents = batchStudents.filter(s => s.status === 'done' && s.score !== null);
        const count = doneStudents.length;

        if (count === 0) {
            batchKpiAvg.innerText = '0.0';
            batchKpiMax.innerText = '0.0';
            batchKpiMaxStudent.innerText = '-';
            batchKpiMin.innerText = '0.0';
            batchKpiMinStudent.innerText = '-';
            batchKpiPassRate.innerText = '0%';
            batchKpiPassCount.innerText = '0/0 học sinh';

            distBarExcellent.style.width = '0%';
            distBarGood.style.width = '0%';
            distBarFair.style.width = '0%';
            distBarPass.style.width = '0%';
            distBarFail.style.width = '0%';
            cntExcellent.innerText = '0';
            cntGood.innerText = '0';
            cntFair.innerText = '0';
            cntPass.innerText = '0';
            cntFail.innerText = '0';

            const commonErrorsBox = document.getElementById('batch-common-errors-box');
            if (commonErrorsBox) commonErrorsBox.classList.add('hidden');
            return;
        }

        let sum = 0;
        let maxVal = -1;
        let maxS = null;
        let minVal = 11;
        let minS = null;
        let passCount = 0;

        let numExc = 0; // >= 9.0
        let numGood = 0; // 8.0 - <9.0
        let numFair = 0; // 6.5 - <8.0
        let numPass = 0; // 5.0 - <6.5
        let numFail = 0; // < 5.0

        doneStudents.forEach(s => {
            const sc = s.score;
            sum += sc;
            if (sc > maxVal) {
                maxVal = sc;
                maxS = s;
            }
            if (sc < minVal) {
                minVal = sc;
                minS = s;
            }
            if (sc >= 5.0) passCount++;

            if (sc >= 9.0) numExc++;
            else if (sc >= 8.0) numGood++;
            else if (sc >= 6.5) numFair++;
            else if (sc >= 5.0) numPass++;
            else numFail++;
        });

        const avg = sum / count;
        batchKpiAvg.innerText = avg.toFixed(1);
        batchKpiMax.innerText = maxVal >= 0 ? maxVal.toFixed(1) : '0.0';
        batchKpiMaxStudent.innerText = maxS ? maxS.name : '-';
        batchKpiMin.innerText = minVal <= 10 ? minVal.toFixed(1) : '0.0';
        batchKpiMinStudent.innerText = minS ? minS.name : '-';

        const passPct = Math.round((passCount / count) * 100);
        batchKpiPassRate.innerText = `${passPct}%`;
        batchKpiPassCount.innerText = `${passCount}/${count} học sinh`;

        // Distribution
        cntExcellent.innerText = numExc;
        cntGood.innerText = numGood;
        cntFair.innerText = numFair;
        cntPass.innerText = numPass;
        cntFail.innerText = numFail;

        distBarExcellent.style.width = `${(numExc / count) * 100}%`;
        distBarGood.style.width = `${(numGood / count) * 100}%`;
        distBarFair.style.width = `${(numFair / count) * 100}%`;
        distBarPass.style.width = `${(numPass / count) * 100}%`;
        distBarFail.style.width = `${(numFail / count) * 100}%`;

        // Populate Top Common Errors across Class
        const commonErrorsBox = document.getElementById('batch-common-errors-box');
        const commonErrorsList = document.getElementById('batch-common-errors-list');
        if (commonErrorsBox && commonErrorsList) {
            const errFreq = {};
            doneStudents.forEach(s => {
                const gc = s.gradingData?.generalComment;
                if (gc?.mainErrors) {
                    gc.mainErrors.forEach(err => {
                        const trimmed = (err || '').trim();
                        if (trimmed && trimmed.length > 4) {
                            errFreq[trimmed] = (errFreq[trimmed] || 0) + 1;
                        }
                    });
                }
                if (gc?.knowledgeToReview) {
                    gc.knowledgeToReview.forEach(item => {
                        const trimmed = (item || '').trim();
                        if (trimmed && trimmed.length > 4) {
                            errFreq[trimmed] = (errFreq[trimmed] || 0) + 1;
                        }
                    });
                }
                if (s.gradingData?.questions) {
                    s.gradingData.questions.forEach(q => {
                        if (q.analysis) {
                            q.analysis.forEach(st => {
                                if (st.status !== 'correct' && st.comment) {
                                    const c = st.comment.trim();
                                    if (c.length > 5 && c.length < 120) {
                                        errFreq[c] = (errFreq[c] || 0) + 1;
                                    }
                                }
                            });
                        }
                    });
                }
            });

            const sortedErrors = Object.entries(errFreq)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4);

            if (sortedErrors.length > 0) {
                commonErrorsBox.classList.remove('hidden');
                commonErrorsList.innerHTML = sortedErrors.map(([err, cnt]) => `
                    <div style="font-size: 12.5px; color: #991b1b; display: flex; align-items: flex-start; gap: 8px; line-height: 1.4;">
                        <span style="background: #fecdd3; color: #9f1239; font-weight: 800; font-size: 11px; padding: 2px 7px; border-radius: 4px; white-space: nowrap; flex-shrink: 0;">
                            ${cnt} học sinh mắc phải
                        </span>
                        <span>${escapeHtml(err)}</span>
                    </div>
                `).join('');
            } else {
                commonErrorsBox.classList.add('hidden');
            }
        }

        // MỤC 3: PHÂN TÍCH MA TRẬN LỖI SAI CẢ LỚP & CÂU HỎI SAI NHIỀU NHẤT
        const heatmapCard = document.getElementById('batch-heatmap-card');
        const heatmapGrid = document.getElementById('batch-heatmap-grid');
        const tipsBox = document.getElementById('pedagogical-tips-box');
        const tipsContent = document.getElementById('pedagogical-tips-content');
        const btnCopyPedagogy = document.getElementById('btn-copy-pedagogy-report');

        if (heatmapCard && heatmapGrid && doneStudents.length > 0) {
            const qStats = {}; // { qId: { total: 0, correct: 0, errors: [] } }

            doneStudents.forEach(s => {
                if (s.gradingData?.questions) {
                    s.gradingData.questions.forEach((q, qIdx) => {
                        const qId = q.questionId || q.question || `Câu ${qIdx + 1}`;
                        if (!qStats[qId]) {
                            qStats[qId] = { id: qId, total: 0, correct: 0, errors: [], topic: q.classification?.topic || '' };
                        }
                        qStats[qId].total++;
                        const isCor = q.status === 'correct' || (q.score !== undefined && q.maxScore !== undefined && q.score === q.maxScore);
                        if (isCor) {
                            qStats[qId].correct++;
                        } else {
                            if (q.feedback) qStats[qId].errors.push(q.feedback);
                        }
                    });
                }
            });

            const qList = Object.values(qStats);
            if (qList.length > 0) {
                qList.forEach(q => {
                    q.rate = q.total > 0 ? Math.round((q.correct / q.total) * 100) : 0;
                });

                let minRate = 100;
                qList.forEach(q => {
                    if (q.rate < minRate) minRate = q.rate;
                });

                heatmapCard.classList.remove('hidden');

                let gridHtml = '';
                qList.forEach(q => {
                    let statusClass = 'status-high';
                    let fillColor = '#16a34a';
                    if (q.rate < 50) {
                        statusClass = 'status-low';
                        fillColor = '#dc2626';
                    } else if (q.rate < 75) {
                        statusClass = 'status-med';
                        fillColor = '#f59e0b';
                    }

                    const isMostMissed = (q.rate === minRate && minRate < 75);

                    gridHtml += `
                        <div class="heatmap-item ${statusClass} ${isMostMissed ? 'is-most-missed' : ''}">
                            <div class="heatmap-q-title">${escapeHtml(q.id)}</div>
                            <div class="heatmap-rate-value">${q.rate}%</div>
                            <div class="heatmap-rate-sub">${q.correct}/${q.total} em đúng</div>
                            <div class="heatmap-progress-bar">
                                <div class="heatmap-progress-fill" style="width: ${q.rate}%; background: ${fillColor};"></div>
                            </div>
                        </div>
                    `;
                });
                heatmapGrid.innerHTML = gridHtml;

                if (tipsBox && tipsContent) {
                    const mostMissedQuestions = qList.filter(q => q.rate === minRate && minRate < 80);
                    if (mostMissedQuestions.length > 0) {
                        const missedNames = mostMissedQuestions.map(q => `${q.id} (chỉ ${q.rate}% đạt)`).join(', ');
                        tipsBox.classList.remove('hidden');
                        tipsContent.innerHTML = `
                            <strong>⚠️ Trọng tâm cần củng cố:</strong> Cả lớp gặp khó khăn lớn nhất ở <strong>${missedNames}</strong>.<br>
                            💡 <strong>Gợi ý sư phạm:</strong> Trong tiết sửa bài tới, Thầy/Cô nên dành 10 - 15 phút đầu giờ để chữa kỹ câu này trên bảng, nhấn mạnh phương pháp biến đổi từng bước, các bẫy dấu âm, phân tích nhân tử và điều kiện xác định để tránh lặp lại lỗi sai.
                        `;
                    } else {
                        tipsBox.classList.remove('hidden');
                        tipsContent.innerHTML = `
                            🎉 <strong>Kết quả rất tốt:</strong> Toàn bộ các câu hỏi đều có tỷ lệ làm đúng trên 80%. Học sinh nắm chắc kiến thức cơ bản. Thầy/Cô có thể triển khai thêm các bài toán mở rộng và nâng cao năng lực cho lớp.
                        `;
                    }
                }

                if (btnCopyPedagogy) {
                    btnCopyPedagogy.onclick = async () => {
                        let rep = `📊 BÁO CÁO PHÂN TÍCH CHẤT LƯỢNG BÀI KIỂM TRA MÔN TOÁN\n`;
                        rep += `Số lượng học sinh đã chấm: ${doneStudents.length}\n`;
                        rep += `Điểm TB: ${document.getElementById('batch-kpi-avg')?.innerText || '-'} • Tỷ lệ Đạt: ${document.getElementById('batch-kpi-pass-rate')?.innerText || '-'}\n\n`;
                        rep += `TỶ LỆ LÀM ĐÚNG THEO TỪNG CÂU:\n`;
                        qList.forEach(q => {
                            rep += `• ${q.id}: ${q.rate}% đúng (${q.correct}/${q.total} học sinh)\n`;
                        });
                        rep += `\nĐỀ XUẤT GIẢNG DẠY CỦNG CỐ:\n`;
                        rep += tipsContent?.innerText || 'Củng cố kiến thức theo phân phối chương trình.';
                        try {
                            await navigator.clipboard.writeText(rep);
                            showToast('📋 Đã sao chép báo cáo chuyên môn! Thầy/cô có thể dán vào sổ kế hoạch giảng dạy.', 'success');
                        } catch (err) {
                            showToast('Hãy chọn và copy nội dung báo cáo trên màn hình.', 'info');
                        }
                    };
                }
            } else {
                heatmapCard.classList.add('hidden');
            }
        } else if (heatmapCard) {
            heatmapCard.classList.add('hidden');
        }
    }

    // --- ATTACH ACTIONS FOR TABLE ROWS ---
    function attachBatchRowActions() {
        // Sao chép tin nhắn Zalo gửi phụ huynh học sinh
        document.querySelectorAll('.btn-batch-zalo').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sId = e.currentTarget.getAttribute('data-id');
                const student = batchStudents.find(s => s.id === sId);
                if (!student) return;
                openZaloModalForStudent(student);
            });
        });

        // Xem phiếu chi tiết (mở giao diện Single mode với dữ liệu học sinh này)
        document.querySelectorAll('.btn-batch-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sId = e.currentTarget.getAttribute('data-id');
                const student = batchStudents.find(s => s.id === sId);
                if (!student || !student.gradingData) return;

                // Load student data into active grading state
                currentGradingData = student.gradingData;
                currentGradingImages = student.pages.map((p, idx) => ({
                    pageIndex: idx,
                    dataUrl: p.dataUrl,
                    name: p.name
                }));
                selectedFileUrl = currentGradingImages[0]?.dataUrl;

                const nameInput = document.getElementById('info-student-name');
                const classInput = document.getElementById('info-student-class');
                const titleInput = document.getElementById('info-lesson-title');
                const dateInput = document.getElementById('info-grading-date');
                if (nameInput) nameInput.value = student.name;
                if (classInput) classInput.value = student.className || '8A';
                if (titleInput) titleInput.value = student.lessonTitle || 'Bài kiểm tra Toán';
                if (dateInput) dateInput.value = student.date || new Date().toLocaleDateString('vi-VN');

                // Switch to Single Tab Result View
                tabBtnSingle.classList.add('active');
                tabBtnBatch.classList.remove('active');
                batchSection.classList.add('hidden');
                sectionUpload.classList.add('hidden');
                sectionResult.classList.remove('hidden');

                renderResult(student.gradingData);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                showToast(`Đang xem phiếu trả bài chi tiết của học sinh: ${student.name}`, 'info');
            });
        });

        // Tải PDF riêng cho học sinh
        document.querySelectorAll('.btn-batch-pdf').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sId = e.currentTarget.getAttribute('data-id');
                const student = batchStudents.find(s => s.id === sId);
                if (!student || !student.gradingData) return;
                exportSinglePdf(student.gradingData, student.pages, {
                    name: student.name,
                    class: student.className,
                    title: student.lessonTitle,
                    date: student.date
                });
            });
        });

        // Tải Ảnh riêng cho học sinh
        document.querySelectorAll('.btn-batch-img').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sId = e.currentTarget.getAttribute('data-id');
                const student = batchStudents.find(s => s.id === sId);
                if (!student || !student.gradingData) return;
                exportSingleImage(student.gradingData, student.pages, {
                    name: student.name,
                    class: student.className,
                    title: student.lessonTitle,
                    date: student.date
                }, 'long');
            });
        });

        // Sửa thông tin & điểm học sinh
        document.querySelectorAll('.btn-batch-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sId = e.currentTarget.getAttribute('data-id');
                const student = batchStudents.find(s => s.id === sId);
                if (!student) return;
                openBatchEditModal(student);
            });
        });

        // Xóa học sinh khỏi danh sách
        document.querySelectorAll('.btn-batch-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sId = e.currentTarget.getAttribute('data-id');
                batchStudents = batchStudents.filter(s => s.id !== sId);
                renderBatchUI();
                showToast('Đã xóa học sinh khỏi danh sách.', 'info');
            });
        });
    }

    // --- BATCH EDIT MODAL ---
    function openBatchEditModal(student) {
        if (!batchEditStudentModal) return;
        batchEditStudentId.value = student.id;
        batchEditStudentName.value = student.name;
        batchEditStudentClass.value = student.className || '8A';
        batchEditStudentScore.value = student.score !== null ? student.score : 10;
        batchEditStudentSummary.value = student.summary || '';
        batchEditStudentModal.classList.remove('hidden');
    }

    function closeBatchEditModal() {
        if (batchEditStudentModal) batchEditStudentModal.classList.add('hidden');
    }

    if (btnCloseBatchEdit) btnCloseBatchEdit.addEventListener('click', closeBatchEditModal);
    if (btnCancelBatchEdit) btnCancelBatchEdit.addEventListener('click', closeBatchEditModal);

    if (btnSaveBatchEdit) {
        btnSaveBatchEdit.addEventListener('click', () => {
            const sId = batchEditStudentId.value;
            const student = batchStudents.find(s => s.id === sId);
            if (!student) return;

            student.name = batchEditStudentName.value.trim() || student.name;
            student.className = batchEditStudentClass.value.trim() || student.className;
            const newScore = parseFloat(batchEditStudentScore.value);
            if (!isNaN(newScore)) {
                student.score = Math.max(0, Math.min(10, Math.round(newScore * 10) / 10));
                student.status = 'done';
                student.isTeacherEdited = true;
                if (student.gradingData) {
                    student.gradingData.score = student.score;
                    student.gradingData.isTeacherEdited = true;
                }
            }
            student.summary = batchEditStudentSummary.value.trim();
            if (student.gradingData) {
                student.gradingData.summary = student.summary;
            }

            closeBatchEditModal();
            renderBatchUI();
            showToast(`Đã cập nhật điểm số cho học sinh ${student.name}!`, 'success');
        });
    }

    // --- BATCH GRADING EXECUTION LOOP ---
    async function startBatchGrading(filterStatus = null) {
        if (isBatchGradingRunning) return;
        isBatchGradingRunning = true;
        batchCancelRequested = false;

        const targetStudents = filterStatus
            ? batchStudents.filter(s => s.status === filterStatus)
            : batchStudents.filter(s => s.status === 'pending' || s.status === 'error');

        if (targetStudents.length === 0) {
            showToast('Không có bài nào cần chấm trong danh sách.', 'info');
            isBatchGradingRunning = false;
            updateBatchProgress(batchStudents.filter(s => s.status === 'done').length, batchStudents.length);
            return;
        }

        btnBatchStart.classList.add('hidden');
        btnBatchStop.classList.remove('hidden');

        const uploadUrl = `${getApiBaseUrl()}/api/v1/upload`;

        for (let i = 0; i < targetStudents.length; i++) {
            if (batchCancelRequested) {
                showToast('Đã tạm dừng quá trình chấm bài hàng loạt.', 'warning');
                break;
            }

            const student = targetStudents[i];
            student.status = 'processing';
            student.errorMsg = null;
            renderBatchUI();

            batchProgressStatusText.innerText = `Đang chấm bài ${i + 1}/${targetStudents.length}: ${student.name}...`;

            try {
                // Tạo FormData gửi các ảnh bài làm của học sinh
                const formData = new FormData();
                if (student.className) formData.append('studentClass', student.className);

                // Chuẩn bị file từ dataUrl hoặc file object
                for (let pIdx = 0; pIdx < student.pages.length; pIdx++) {
                    const page = student.pages[pIdx];
                    if (page.file instanceof File) {
                        formData.append('files', page.file);
                    } else if (page.dataUrl) {
                        // Chuyển dataUrl thành Blob
                        const res = await fetch(page.dataUrl);
                        const blob = await res.blob();
                        formData.append('files', blob, page.name || `page_${pIdx + 1}.jpg`);
                    }
                }

                // Header custom API key nếu người dùng cài đặt
                const headers = {};
                const customKey = localStorage.getItem('MATSUDA_CUSTOM_GEMINI_KEY');
                if (customKey) {
                    headers['x-api-key'] = customKey;
                }

                const response = await fetch(uploadUrl, {
                    method: 'POST',
                    body: formData,
                    headers: headers
                });

                const ct = response.headers.get('content-type') || '';
                let data;
                if (ct.includes('application/json')) {
                    data = await response.json();
                } else {
                    const rawText = await response.text();
                    throw new Error(`Máy chủ trả về trạng thái ${response.status}: ${rawText.slice(0, 100)}`);
                }

                if (!response.ok || !data.success) {
                    throw new Error(data.message || `Lỗi máy chủ (${response.status})`);
                }

                // Ghi nhận thành công
                student.status = 'done';
                student.score = data.score !== undefined ? data.score : 0;
                student.maxScore = data.maxScore || 10;
                student.verdict = getScoreTier(student.score).badge;
                student.summary = data.summary || '';
                student.gradingData = data;

                // Tự động lưu bài chấm vào IndexedDB lịch sử
                try {
                    const historyItem = {
                        id: 'grade_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                        createdAt: new Date().toISOString(),
                        dateDisplay: student.date,
                        title: student.lessonTitle || 'Bài kiểm tra Toán',
                        studentName: student.name,
                        studentClass: student.className,
                        score: student.score,
                        maxScore: student.maxScore,
                        result: student.verdict,
                        summary: student.summary,
                        images: student.pages.map((p, idx) => ({ pageIndex: idx, dataUrl: p.dataUrl, name: p.name })),
                        gradingData: data
                    };
                    await MatsudaDB.saveHistory(historyItem);
                    await updateHistoryBadge();
                } catch (dbErr) {
                    console.warn('Lỗi lưu lịch sử:', dbErr);
                }

            } catch (err) {
                console.error(`Lỗi chấm bài học sinh ${student.name}:`, err);
                student.status = 'error';
                student.errorMsg = err.message || 'Lỗi xử lý khi chấm bài';
                showToast(`Lỗi khi chấm bài cho ${student.name}: ${err.message}`, 'error');
            }

            renderBatchUI();

            // Nghỉ 800ms giữa các học sinh để đảm bảo an toàn tốc độ API
            if (i < targetStudents.length - 1 && !batchCancelRequested) {
                await new Promise(r => setTimeout(r, 800));
            }
        }

        isBatchGradingRunning = false;
        btnBatchStart.classList.remove('hidden');
        btnBatchStop.classList.add('hidden');

        const doneCount = batchStudents.filter(s => s.status === 'done').length;
        updateBatchProgress(doneCount, batchStudents.length);
        renderBatchUI();

        if (!batchCancelRequested) {
            showToast(`Hoàn tất chấm bài cả lớp! Đã chấm thành công ${doneCount}/${batchStudents.length} học sinh.`, 'success');
        }
    }

    if (btnBatchStart) {
        btnBatchStart.addEventListener('click', () => {
            startBatchGrading();
        });
    }

    if (btnBatchStop) {
        btnBatchStop.addEventListener('click', () => {
            batchCancelRequested = true;
            batchProgressStatusText.innerText = 'Đang dừng sau khi hoàn thành học sinh hiện tại...';
            btnBatchStop.disabled = true;
            setTimeout(() => {
                btnBatchStop.disabled = false;
            }, 1500);
        });
    }

    if (btnBatchRetryFailed) {
        btnBatchRetryFailed.addEventListener('click', () => {
            startBatchGrading('error');
        });
    }

    // --- BATCH EXPORT EXCEL (CSV UTF-8 BOM) ---
    if (btnBatchExportExcel) {
        btnBatchExportExcel.addEventListener('click', () => {
            if (batchStudents.length === 0) {
                showToast('Chưa có học sinh nào trong danh sách để xuất bảng điểm.', 'warning');
                return;
            }

            let csvContent = '\uFEFF'; // Byte Order Mark for Excel UTF-8 support
            csvContent += 'STT,Họ và tên,Lớp,Bài kiểm tra,Điểm số,Xếp loại,Trạng thái,Lời phê của giáo viên,Ngày chấm\r\n';

            batchStudents.forEach((s, idx) => {
                const stt = idx + 1;
                const name = `"${(s.name || '').replace(/"/g, '""')}"`;
                const cls = `"${(s.className || '').replace(/"/g, '""')}"`;
                const title = `"${(s.lessonTitle || '').replace(/"/g, '""')}"`;
                const score = s.score !== null ? s.score.toFixed(1) : 'Chưa có';
                const verdict = `"${getScoreTier(s.score || 0).badge}"`;
                const status = s.status === 'done' ? 'Đã chấm' : (s.status === 'error' ? 'Lỗi' : 'Chờ chấm');
                const summary = `"${(s.summary || '').replace(/"/g, '""').replace(/\r?\n|\r/g, ' ')}"`;
                const date = `"${s.date || ''}"`;

                csvContent += `${stt},${name},${cls},${title},${score},${verdict},${status},${summary},${date}\r\n`;
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = sanitizeFileName(`Bang_diem_lop_Toan_Matsuda_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '_')}`) + '.csv';
            link.click();

            showToast('📊 Đã xuất Bảng điểm lớp học ra file CSV (chuẩn font tiếng Việt mở trên Excel)!', 'success');
        });
    }

    // --- BATCH EXPORT ALL PDFS TO 1 ZIP ARCHIVE ---
    if (btnBatchExportZipPdf) {
        btnBatchExportZipPdf.addEventListener('click', async () => {
            const doneStudents = batchStudents.filter(s => s.status === 'done' && s.gradingData);
            if (doneStudents.length === 0) {
                showToast('Chưa có học sinh nào chấm xong để tạo file nén ZIP.', 'warning');
                return;
            }

            if (!window.JSZip || !window.html2pdf) {
                showToast('Thư viện tạo file ZIP chưa sẵn sàng. Đang chuyển sang tải lần lượt từng file PDF...', 'warning');
                btnBatchExportAllPdf?.click();
                return;
            }

            btnBatchExportZipPdf.disabled = true;
            btnBatchExportZipPdf.innerText = '⏳ Đang nén ZIP...';
            showToast(`Bắt đầu tạo file PDF và đóng gói ZIP cho ${doneStudents.length} học sinh...`, 'info');

            try {
                const zip = new window.JSZip();
                const wrapper = document.getElementById('export-sheet-wrapper');
                wrapper.style.display = 'block';
                wrapper.style.position = 'fixed';
                wrapper.style.top = '0px';
                wrapper.style.left = '0px';
                wrapper.style.zIndex = '-9999';

                for (let i = 0; i < doneStudents.length; i++) {
                    const s = doneStudents[i];
                    btnBatchExportZipPdf.innerText = `⏳ Nén ${i + 1}/${doneStudents.length} PDF...`;

                    const sheet = buildPrintableSheet(s.gradingData, s.pages, {
                        name: s.name,
                        class: s.className,
                        title: s.lessonTitle,
                        date: s.date
                    });

                    const opt = {
                        margin: [4, 6, 4, 6],
                        image: { type: 'jpeg', quality: 0.98 },
                        html2canvas: {
                            scale: 2,
                            useCORS: true,
                            logging: false,
                            scrollY: 0,
                            scrollX: 0,
                            y: 0,
                            x: 0,
                            windowWidth: 794
                        },
                        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                        pagebreak: { mode: ['css', 'legacy'], avoid: ['.ps-step-avoid', '.ps-signatures-block', '.ps-card-avoid'] }
                    };

                    const pdfBlob = await window.html2pdf().set(opt).from(sheet).outputPdf('blob');
                    const cleanName = sanitizeFileName(`${i + 1}_${s.name}_${s.className}_Diem_${s.score}`);
                    zip.file(`${cleanName}.pdf`, pdfBlob);
                }

                wrapper.style.display = 'none';

                btnBatchExportZipPdf.innerText = '📦 Đang đóng gói ZIP...';
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(zipBlob);
                link.download = sanitizeFileName(`Phieu_Cham_PDF_Lop_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '_')}`) + '.zip';
                link.click();

                showToast(`🎉 Đã tải xuống thành công file nén ZIP chứa toàn bộ ${doneStudents.length} phiếu PDF!`, 'success');
            } catch (err) {
                console.error('Error generating PDF ZIP:', err);
                showToast('Lỗi khi nén file PDF: ' + err.message, 'error');
            } finally {
                btnBatchExportZipPdf.disabled = false;
                btnBatchExportZipPdf.innerText = '📦 Tải ZIP (Tất Cả PDF)';
            }
        });
    }

    // --- BATCH EXPORT ALL IMAGES TO 1 ZIP ARCHIVE ---
    if (btnBatchExportZipImg) {
        btnBatchExportZipImg.addEventListener('click', async () => {
            const doneStudents = batchStudents.filter(s => s.status === 'done' && s.gradingData);
            if (doneStudents.length === 0) {
                showToast('Chưa có học sinh nào chấm xong để tạo file nén ZIP.', 'warning');
                return;
            }

            if (!window.JSZip || !window.html2canvas) {
                showToast('Thư viện tạo file ZIP chưa sẵn sàng. Đang chuyển sang tải lần lượt từng ảnh...', 'warning');
                btnBatchExportAllImg?.click();
                return;
            }

            btnBatchExportZipImg.disabled = true;
            btnBatchExportZipImg.innerText = '⏳ Đang nén ZIP...';
            showToast(`Bắt đầu kết xuất ảnh và đóng gói ZIP cho ${doneStudents.length} học sinh...`, 'info');

            try {
                const zip = new window.JSZip();
                const wrapper = document.getElementById('export-sheet-wrapper');
                wrapper.style.display = 'block';
                wrapper.style.position = 'fixed';
                wrapper.style.top = '0px';
                wrapper.style.left = '0px';
                wrapper.style.zIndex = '-9999';

                for (let i = 0; i < doneStudents.length; i++) {
                    const s = doneStudents[i];
                    btnBatchExportZipImg.innerText = `⏳ Nén ${i + 1}/${doneStudents.length} Ảnh...`;

                    const sheet = buildPrintableSheet(s.gradingData, s.pages, {
                        name: s.name,
                        class: s.className,
                        title: s.lessonTitle,
                        date: s.date
                    });

                    const canvas = await window.html2canvas(sheet, {
                        scale: 2,
                        useCORS: true,
                        scrollY: 0,
                        scrollX: 0,
                        y: 0,
                        x: 0,
                        windowWidth: 794,
                        backgroundColor: '#ffffff'
                    });

                    const imgBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                    const cleanName = sanitizeFileName(`${i + 1}_${s.name}_${s.className}_Diem_${s.score}`);
                    zip.file(`${cleanName}.png`, imgBlob);
                }

                wrapper.style.display = 'none';

                btnBatchExportZipImg.innerText = '📦 Đang đóng gói ZIP...';
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(zipBlob);
                link.download = sanitizeFileName(`Anh_Phieu_Cham_Lop_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '_')}`) + '.zip';
                link.click();

                showToast(`🎉 Đã tải xuống thành công file nén ZIP chứa toàn bộ ${doneStudents.length} ảnh phiếu!`, 'success');
            } catch (err) {
                console.error('Error generating Image ZIP:', err);
                showToast('Lỗi khi nén ảnh: ' + err.message, 'error');
            } finally {
                btnBatchExportZipImg.disabled = false;
                btnBatchExportZipImg.innerText = '📦 Tải ZIP (Tất Cả Ảnh)';
            }
        });
    }

    // --- BATCH DRAG AND DROP HANDLERS ---
    const batchDropTargets = [batchSection, batchEmptyState].filter(Boolean);
    batchDropTargets.forEach(target => {
        target.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            target.classList.add('drag-over');
        });
        target.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            target.classList.remove('drag-over');
        });
        target.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            target.classList.remove('drag-over');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleBatchFilesSelected(e.dataTransfer.files);
            }
        });
    });

    // --- BATCH EXPORT ALL PDFS ---
    if (btnBatchExportAllPdf) {
        btnBatchExportAllPdf.addEventListener('click', async () => {
            const doneStudents = batchStudents.filter(s => s.status === 'done' && s.gradingData);
            if (doneStudents.length === 0) {
                showToast('Chưa có học sinh nào chấm xong để xuất PDF.', 'warning');
                return;
            }

            btnBatchExportAllPdf.disabled = true;
            btnBatchExportAllPdf.innerText = '⏳ Đang tải toàn bộ PDF...';
            showToast(`Bắt đầu tải lần lượt ${doneStudents.length} phiếu PDF cho cả lớp...`, 'info');

            for (let i = 0; i < doneStudents.length; i++) {
                const s = doneStudents[i];
                try {
                    await exportSinglePdf(s.gradingData, s.pages, {
                        name: s.name,
                        class: s.className,
                        title: s.lessonTitle,
                        date: s.date
                    });
                } catch (err) {
                    console.error('Error exporting PDF for', s.name, err);
                }
                // Delay 600ms between file downloads
                await new Promise(r => setTimeout(r, 600));
            }

            btnBatchExportAllPdf.disabled = false;
            btnBatchExportAllPdf.innerText = '📄 Tải Toàn Bộ PDF';
            showToast('Đã hoàn tất tải toàn bộ phiếu PDF cho cả lớp!', 'success');
        });
    }

    // --- BATCH EXPORT ALL IMAGES ---
    if (btnBatchExportAllImg) {
        btnBatchExportAllImg.addEventListener('click', async () => {
            const doneStudents = batchStudents.filter(s => s.status === 'done' && s.gradingData);
            if (doneStudents.length === 0) {
                showToast('Chưa có học sinh nào chấm xong để xuất Ảnh.', 'warning');
                return;
            }

            btnBatchExportAllImg.disabled = true;
            btnBatchExportAllImg.innerText = '⏳ Đang tải toàn bộ Ảnh...';
            showToast(`Bắt đầu tải lần lượt ${doneStudents.length} ảnh phiếu cho cả lớp...`, 'info');

            for (let i = 0; i < doneStudents.length; i++) {
                const s = doneStudents[i];
                try {
                    await exportSingleImage(s.gradingData, s.pages, {
                        name: s.name,
                        class: s.className,
                        title: s.lessonTitle,
                        date: s.date
                    }, 'long');
                } catch (err) {
                    console.error('Error exporting Image for', s.name, err);
                }
                // Delay 600ms between file downloads
                await new Promise(r => setTimeout(r, 600));
            }

            btnBatchExportAllImg.disabled = false;
            btnBatchExportAllImg.innerText = '🖼️ Tải Toàn Bộ Ảnh';
            showToast('Đã hoàn tất tải toàn bộ ảnh phiếu cho cả lớp!', 'success');
        });
    }

    // --- CONTROLLERS CHO MODAL PHÍM TẮT & MODAL TRA CỨU QR ---
    const hotkeysModal = document.getElementById('hotkeys-modal');
    const btnOpenHotkeys = document.getElementById('btn-open-hotkeys');
    const btnCloseHotkeys = document.getElementById('btn-close-hotkeys');
    const btnConfirmHotkeys = document.getElementById('btn-confirm-hotkeys');

    if (btnOpenHotkeys && hotkeysModal) {
        btnOpenHotkeys.addEventListener('click', () => {
            hotkeysModal.classList.remove('hidden');
        });
    }
    if (btnCloseHotkeys && hotkeysModal) {
        btnCloseHotkeys.addEventListener('click', () => {
            hotkeysModal.classList.add('hidden');
        });
    }
    if (btnConfirmHotkeys && hotkeysModal) {
        btnConfirmHotkeys.addEventListener('click', () => {
            hotkeysModal.classList.add('hidden');
        });
    }

    const qrLookupModal = document.getElementById('qr-lookup-modal');
    const btnCloseQrLookup = document.getElementById('btn-close-qr-lookup');
    const btnConfirmQrLookup = document.getElementById('btn-confirm-qr-lookup');

    if (btnCloseQrLookup && qrLookupModal) {
        btnCloseQrLookup.addEventListener('click', () => {
            qrLookupModal.classList.add('hidden');
        });
    }
    if (btnConfirmQrLookup && qrLookupModal) {
        btnConfirmQrLookup.addEventListener('click', () => {
            qrLookupModal.classList.add('hidden');
        });
    }

    // --- BỘ PHÍM TẮT THÔNG MINH CHO GIÁO VIÊN (HOTKEYS) ---
    window.addEventListener('keydown', (e) => {
        // Phím Escape: Đóng nhanh mọi modal đang mở
        if (e.key === 'Escape') {
            const modalIds = [
                'hotkeys-modal',
                'qr-lookup-modal',
                'preview-sheet-modal',
                'branding-modal',
                'batch-edit-student-modal',
                'history-modal',
                'teacher-edit-modal',
                'export-options-modal'
            ];
            let closedAny = false;
            modalIds.forEach(id => {
                const el = document.getElementById(id);
                if (el && !el.classList.contains('hidden')) {
                    el.classList.add('hidden');
                    closedAny = true;
                }
            });
            if (closedAny) return;
        }

        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isTyping = (activeTag === 'input' || activeTag === 'textarea');

        // Phím F1 hoặc ?: Mở bảng hướng dẫn phím tắt
        if ((e.key === 'F1' || (!isTyping && e.key === '?') || (e.ctrlKey && e.key === '/'))) {
            e.preventDefault();
            if (hotkeysModal) {
                hotkeysModal.classList.toggle('hidden');
            }
            return;
        }

        // Ctrl + Enter hoặc Cmd + Enter: Bắt đầu chấm bài nhanh
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            // Nếu modal sửa đang mở, lưu modal đó
            const teacherEditModal = document.getElementById('teacher-edit-modal');
            if (teacherEditModal && !teacherEditModal.classList.contains('hidden')) {
                document.getElementById('btn-save-edit')?.click();
                return;
            }
            const batchEditModal = document.getElementById('batch-edit-student-modal');
            if (batchEditModal && !batchEditModal.classList.contains('hidden')) {
                document.getElementById('btn-save-batch-edit')?.click();
                return;
            }
            const brandingModal = document.getElementById('branding-modal');
            if (brandingModal && !brandingModal.classList.contains('hidden')) {
                document.getElementById('btn-save-branding')?.click();
                return;
            }

            // Nếu đang ở tab Chấm Hàng Loạt
            if (batchSection && !batchSection.classList.contains('hidden')) {
                if (!isBatchGradingRunning) {
                    btnBatchStart?.click();
                } else {
                    btnBatchStop?.click();
                }
                return;
            }

            // Nếu đang ở tab Chấm Bài Đơn
            if (sectionUpload && !sectionUpload.classList.contains('hidden')) {
                const btnGrade = document.getElementById('btn-grade');
                if (btnGrade && !btnGrade.disabled) {
                    btnGrade.click();
                } else {
                    showToast('Vui lòng chọn hoặc chụp ảnh bài làm trước khi chấm!', 'warning');
                }
                return;
            }
        }

        // Ctrl + P hoặc Cmd + P: In nhanh phiếu chấm điểm A4
        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
            const previewModal = document.getElementById('preview-sheet-modal');
            if (previewModal && !previewModal.classList.contains('hidden')) {
                e.preventDefault();
                document.getElementById('btn-preview-modal-print')?.click();
                return;
            }

            if (sectionResult && !sectionResult.classList.contains('hidden') && currentGradingData) {
                e.preventDefault();
                document.getElementById('btn-print-sheet')?.click();
                return;
            }
        }

        // Ctrl + S hoặc Cmd + S: Xuất PDF hoặc Sổ Điểm CSV
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
            if (sectionResult && !sectionResult.classList.contains('hidden') && currentGradingData) {
                e.preventDefault();
                document.getElementById('btn-export-pdf')?.click();
                return;
            }
            if (batchSection && !batchSection.classList.contains('hidden') && batchStudents.length > 0) {
                e.preventDefault();
                document.getElementById('btn-batch-export-excel')?.click();
                return;
            }
        }
    });

    // ========================================================
    // PWA: SERVICE WORKER & CÀI ĐẶT ỨNG DỤNG (WEB APP)
    // ========================================================
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').then((reg) => {
                console.log('PWA ServiceWorker registered successfully:', reg.scope);
            }).catch((err) => {
                console.warn('PWA ServiceWorker registration failed:', err);
            });
        });
    }

    let deferredPwaPrompt = null;
    const btnPwaInstall = document.getElementById('btn-pwa-install');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPwaPrompt = e;
        if (btnPwaInstall) {
            btnPwaInstall.style.display = 'inline-flex';
        }
    });

    if (btnPwaInstall) {
        btnPwaInstall.addEventListener('click', async () => {
            if (deferredPwaPrompt) {
                deferredPwaPrompt.prompt();
                const { outcome } = await deferredPwaPrompt.userChoice;
                if (outcome === 'accepted') {
                    showToast('🎉 Đã cài đặt ứng dụng Toán Matsuda AI vào màn hình chính!', 'success');
                }
                deferredPwaPrompt = null;
            } else {
                const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
                if (isIos) {
                    showToast('📱 Hướng dẫn trên iPhone/iPad: Bấm nút Chia sẻ (Share) 📤 ở thanh dưới Safari, sau đó chọn "Thêm vào MH chính" (Add to Home Screen) ➕.', 'info');
                } else {
                    showToast('💡 Thầy/Cô có thể bấm vào biểu tượng Cài đặt (Install) 📲 trên thanh địa chỉ của Chrome/Edge để cài đặt ứng dụng.', 'info');
                }
            }
        });
    }

    window.addEventListener('appinstalled', () => {
        deferredPwaPrompt = null;
        showToast('🎉 Chúc mừng! Ứng dụng Toán Matsuda AI đã sẵn sàng hoạt động như App độc lập trên thiết bị.', 'success');
    });

    // ========================================================
    // MỤC 1: GIA SƯ SOCRATIC AI - DẪN DẮT TƯ DUY, KHÔNG GIẢI HỘ
    // ========================================================
    const socraticModal = document.getElementById('socratic-tutor-modal');
    const socraticProblemInput = document.getElementById('socratic-problem-input');
    const socraticContextBadge = document.getElementById('socratic-context-badge');
    const socraticContextPreview = document.getElementById('socratic-context-preview');
    const socraticChatHistory = document.getElementById('socratic-chat-history');
    const socraticUserMsgInput = document.getElementById('socratic-user-msg-input');
    const btnSocraticSend = document.getElementById('btn-socratic-send');
    const btnCloseSocraticModal = document.getElementById('btn-close-socratic-modal');
    const btnOpenSocraticTutor = document.getElementById('btn-open-socratic-tutor');
    const cardFeatureTutor = document.getElementById('card-feature-tutor');
    const btnSocraticHint1 = document.getElementById('btn-socratic-hint-1');
    const btnSocraticHint2 = document.getElementById('btn-socratic-hint-2');
    const btnSocraticHint3 = document.getElementById('btn-socratic-hint-3');
    const btnClearSocraticChat = document.getElementById('btn-clear-socratic-chat');

    let socraticActiveContext = '';
    let socraticMessageLog = []; // [{ role: 'user' | 'model', text: string }]

    function openSocraticTutor(problemText = '', contextText = '') {
        if (!socraticModal) return;

        if (problemText) {
            socraticProblemInput.value = problemText.trim();
        } else if (!socraticProblemInput.value.trim() && currentGradingData && currentGradingData.questions && currentGradingData.questions.length > 0) {
            // Tự động gợi ý câu hỏi đầu tiên hoặc câu bị trừ điểm nhiều nhất
            const failedQ = currentGradingData.questions.find(q => q.result === 'Sai' || q.status === 'incorrect') || currentGradingData.questions[0];
            if (failedQ) {
                socraticProblemInput.value = failedQ.problemStatementLatex || `Câu ${failedQ.questionId || '1'}`;
                if (failedQ.feedback) contextText = failedQ.feedback;
            }
        }

        socraticActiveContext = contextText ? contextText.trim() : '';

        if (socraticActiveContext) {
            if (socraticContextBadge) socraticContextBadge.classList.remove('hidden');
            if (socraticContextPreview) {
                socraticContextPreview.innerHTML = `<strong>⚠️ Ngữ cảnh bài làm:</strong> ${formatMathText(socraticActiveContext)}`;
                socraticContextPreview.classList.remove('hidden');
            }
        } else {
            if (socraticContextBadge) socraticContextBadge.classList.add('hidden');
            if (socraticContextPreview) socraticContextPreview.classList.add('hidden');
        }

        socraticModal.classList.remove('hidden');
        setTimeout(() => {
            if (socraticUserMsgInput) socraticUserMsgInput.focus();
        }, 150);
    }

    function closeSocraticTutor() {
        if (socraticModal) {
            socraticModal.classList.add('hidden');
        }
    }

    function appendSocraticBubble(role, contentText, hintLevel = null) {
        if (!socraticChatHistory) return;

        const welcomeCard = document.getElementById('socratic-welcome-card');
        if (welcomeCard && socraticMessageLog.length > 0) {
            welcomeCard.style.display = 'none';
        }

        const row = document.createElement('div');
        row.className = `socratic-msg-row ${role} fade-in`;

        if (role === 'model') {
            const avatar = document.createElement('div');
            avatar.className = 'socratic-msg-avatar';
            avatar.innerHTML = currentTutorMode === 'teacher' ? '👨‍🏫' : '🤖';
            row.appendChild(avatar);
        }

        let bubbleClassLevel = '';
        if (hintLevel === 'hint1' || hintLevel === 'teacher1') bubbleClassLevel = 'hint-level-1';
        else if (hintLevel === 'hint2' || hintLevel === 'teacher2') bubbleClassLevel = 'hint-level-2';
        else if (hintLevel === 'hint3' || hintLevel === 'teacher3') bubbleClassLevel = 'hint-level-3';

        const bubble = document.createElement('div');
        bubble.className = `socratic-bubble ${bubbleClassLevel}`;

        if (hintLevel) {
            const tag = document.createElement('div');
            let tagNum = '1';
            let tagText = '';

            if (hintLevel === 'hint1') { tagNum = '1'; tagText = '💡 GỢI Ý 1: CÔNG THỨC & ĐỊNH LÝ'; }
            else if (hintLevel === 'hint2') { tagNum = '2'; tagText = '🔍 GỢI Ý 2: HƯỚNG ĐI & NÚT THẮT'; }
            else if (hintLevel === 'hint3') { tagNum = '3'; tagText = '📘 GỢI Ý 3: DẪN DẮT CHI TIẾT'; }
            else if (hintLevel === 'teacher1') { tagNum = '1'; tagText = '📚 SOẠN 3 BÀI TẬP PHÂN HÓA (DỄ - VỪA - NÂNG CAO)'; }
            else if (hintLevel === 'teacher2') { tagNum = '2'; tagText = '💬 TIN NHẮN ZALO MẪU GỬI PHỤ HUYNH'; }
            else if (hintLevel === 'teacher3') { tagNum = '3'; tagText = '📊 PHÂN TÍCH SƯ PHẠM & TIẾT HỌC SAU'; }

            tag.className = `socratic-badge-hint-tag tag-${tagNum}`;
            tag.innerText = tagText;
            bubble.appendChild(tag);
        }

        const textDiv = document.createElement('div');
        textDiv.innerHTML = formatMathText(contentText);
        bubble.appendChild(textDiv);

        // Nút sao chép nội dung nhanh cho tin nhắn model
        if (role === 'model') {
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'btn-copy-bubble-content';
            copyBtn.innerHTML = '📋 Sao chép nội dung';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(contentText).then(() => {
                    showToast('Đã sao chép nội dung vào bộ nhớ tạm!', 'success');
                }).catch(() => {
                    showToast('Không thể sao chép tự động.', 'error');
                });
            };
            bubble.appendChild(copyBtn);
        }

        row.appendChild(bubble);
        socraticChatHistory.appendChild(row);
        socraticChatHistory.scrollTop = socraticChatHistory.scrollHeight;

        // Auto render math
        if (window.renderMathInElement) {
            try {
                window.renderMathInElement(bubble, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '\\[', right: '\\]', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false}
                    ],
                    throwOnError: false
                });
            } catch (err) {}
        }
    }

    function showSocraticTyping(customMessage = null) {
        const id = 'socratic-typing-indicator';
        const old = document.getElementById(id);
        if (old) old.remove();

        const defaultMsg = currentTutorMode === 'teacher' 
            ? '👨‍🏫 Trợ lý Giáo viên đang phân tích và soạn bài...'
            : 'Gia sư AI đang chuẩn bị gợi mở tư duy...';

        const row = document.createElement('div');
        row.id = id;
        row.className = 'socratic-msg-row model fade-in';
        row.innerHTML = `
            <div class="socratic-msg-avatar">${currentTutorMode === 'teacher' ? '👨‍🏫' : '🤖'}</div>
            <div class="socratic-bubble" style="background: #f1f5f9; color: #64748b; font-style: italic; font-size: 12.5px;">
                <span class="step-icon">⏳</span> ${escapeHtml(customMessage || defaultMsg)}
            </div>
        `;
        socraticChatHistory.appendChild(row);
        socraticChatHistory.scrollTop = socraticChatHistory.scrollHeight;
    }

    function removeSocraticTyping() {
        const el = document.getElementById('socratic-typing-indicator');
        if (el) el.remove();
    }

    async function requestSocraticHint(level) {
        const problem = socraticProblemInput ? socraticProblemInput.value.trim() : '';
        if (!problem) {
            showToast('⚠️ Vui lòng nhập đề bài hoặc nội dung câu hỏi trước nhé!', 'warning');
            if (socraticProblemInput) socraticProblemInput.focus();
            return;
        }

        const levelLabel = level === 'hint1' ? 'Gợi ý 1 (Nhẹ)' : (level === 'hint2' ? 'Gợi ý 2 (Vừa)' : 'Gợi ý 3 (Sâu)');
        appendSocraticBubble('user', `⚡ Em xin Thầy/Cô ${levelLabel}`);
        socraticMessageLog.push({ role: 'user', text: `Yêu cầu ${levelLabel}` });

        showSocraticTyping();

        try {
            const resp = await fetch('/api/tutor/socratic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    problem,
                    context: socraticActiveContext,
                    level,
                    chatHistory: socraticMessageLog
                })
            });

            const data = await resp.json();
            removeSocraticTyping();

            if (data.success && data.reply) {
                appendSocraticBubble('model', data.reply, level);
                socraticMessageLog.push({ role: 'model', text: data.reply });
                recordGrowthActivity('hint', `Xem gợi ý ${levelLabel}`, problem || 'Bài toán', 10);
            } else {
                appendSocraticBubble('model', data.message || 'Thầy/Cô tạm thời chưa nhận được phản hồi, em vui lòng bấm lại nhé!');
            }
        } catch (err) {
            removeSocraticTyping();
            appendSocraticBubble('model', '⚠️ Kết nối mạng bị gián đoạn trong giây lát. Em hãy thử bấm lại nhé!');
        }
    }

    async function sendSocraticChatMessage(customText = null) {
        const problem = socraticProblemInput ? socraticProblemInput.value.trim() : '';
        const msg = (customText || (socraticUserMsgInput ? socraticUserMsgInput.value : '')).trim();

        if (!msg) return;

        if (socraticUserMsgInput) socraticUserMsgInput.value = '';

        appendSocraticBubble('user', msg);
        socraticMessageLog.push({ role: 'user', text: msg });

        showSocraticTyping();

        try {
            const resp = await fetch('/api/tutor/socratic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    problem,
                    context: socraticActiveContext,
                    level: 'chat',
                    studentMessage: msg,
                    chatHistory: socraticMessageLog,
                    mode: currentTutorMode
                })
            });

            const data = await resp.json();
            removeSocraticTyping();

            if (data.success && data.reply) {
                appendSocraticBubble('model', data.reply);
                socraticMessageLog.push({ role: 'model', text: data.reply });
            } else {
                appendSocraticBubble('model', data.message || 'Thầy/Cô đang lắng nghe, em có thể diễn đạt thêm không?');
            }
        } catch (err) {
            removeSocraticTyping();
            appendSocraticBubble('model', '⚠️ Đang xảy ra gián đoạn mạng. Em hãy gửi lại câu hỏi nhé!');
        }
    }

    // Window global functions for inline buttons
    window.openSocraticTutorModal = openSocraticTutor;
    window.closeSocraticTutorModal = closeSocraticTutor;

    window.askSocraticAboutQuestion = function(idx) {
        if (!currentGradingData || !currentGradingData.questions || !currentGradingData.questions[idx]) return;
        const q = currentGradingData.questions[idx];
        const problemText = q.problemStatementLatex || `Câu ${q.questionId || (idx + 1)}`;
        
        let contextParts = [];
        if (q.classification) {
            contextParts.push(`Dạng bài: ${q.classification.topic || ''} - ${q.classification.subtopic || ''}`);
        }
        if (q.analysis && Array.isArray(q.analysis)) {
            const firstErr = q.analysis.find(s => s.isFirstError || s.status === 'incorrect');
            if (firstErr) {
                contextParts.push(`Lỗi sai tại Bước ${firstErr.stepNumber}: Học sinh viết ${firstErr.studentLatex || ''}. Nhận xét: ${firstErr.comment || ''}`);
            }
        }
        if (q.feedback) {
            contextParts.push(`Nhận xét tổng thể: ${q.feedback}`);
        }

        openSocraticTutor(problemText, contextParts.join('\n'));
    };

    // MỤC 2: HỎI GIA SƯ VỀ TỪNG BƯỚC GIẢI CỤ THỂ
    window.askSocraticAboutStep = function(qIdx, sIdx) {
        if (!currentGradingData || !currentGradingData.questions || !currentGradingData.questions[qIdx]) return;
        const q = currentGradingData.questions[qIdx];
        if (!q.analysis || !q.analysis[sIdx]) return;
        const step = q.analysis[sIdx];
        const problemText = q.problemStatementLatex || `Câu ${q.questionId || (qIdx + 1)}`;

        const errType = step.isFirstError ? '🎯 LỖI ĐẦU TIÊN (GỐC)' : (step.status === 'cascading_error' || step.isFollowUpError ? '🔗 LỖI KÉO THEO' : (step.isIndependentError ? '⚡ LỖI ĐỘC LẬP' : 'CẦN HOÀN THIỆN'));
        
        const contextText = `Bước ${step.stepNumber}: Học sinh viết: "${step.studentLatex || step.studentText || ''}". Nhận định: ${errType}. ${step.comment ? `Nhận xét: ${step.comment}` : ''}`;

        openSocraticTutor(problemText, contextText);

        // Mở sẵn bảng nháp để học sinh sẵn sàng thử sức làm lại
        const scratchpadBody = document.getElementById('scratchpad-body-content');
        const btnToggleScratchpad = document.getElementById('btn-toggle-scratchpad');
        if (scratchpadBody && scratchpadBody.classList.contains('hidden')) {
            scratchpadBody.classList.remove('hidden');
            if (btnToggleScratchpad) btnToggleScratchpad.innerHTML = 'Thu gọn bảng nháp ▴';
        }

        // Tự động gửi lời mở đầu đàm thoại từ Gia sư AI
        const autoIntro = `Thầy/Cô thấy ở **Bước ${step.stepNumber}**, em viết $${step.studentLatex || step.studentText || ''}$. ${step.comment ? `Nhận xét: *${step.comment}*` : ''}\n\n👉 Em có muốn thử kiểm tra lại quy tắc biến đổi ở bước này, hoặc bấm **Gợi ý 1** để nhớ lại công thức không? Em cũng có thể gõ thử lời giải mới vào **Bảng nháp** phía trên nhé!`;
        appendSocraticBubble('model', autoIntro);
        socraticMessageLog.push({ role: 'model', text: autoIntro });
    };

    window.askSocraticAboutRemedial = function(rmId) {
        const itemEl = document.querySelector(`.remedial-item-card[data-remedial-id="${rmId}"]`);
        let prob = '';
        let ctx = '';
        if (itemEl) {
            const probBody = itemEl.querySelector('.remedial-problem-body');
            if (probBody) prob = probBody.innerText.replace('Đề bài rèn luyện:', '').trim();
            const weakEl = itemEl.querySelector('[style*="color: #b91c1c"]');
            if (weakEl) ctx = weakEl.innerText.replace('⚠️ Lỗ hổng cần khắc phục:', '').trim();
        }
        openSocraticTutor(prob || 'Bài tập củng cố kiến thức', ctx ? `Mục tiêu củng cố: ${ctx}` : '');

        // Mở sẵn bảng nháp
        const scratchpadBody = document.getElementById('scratchpad-body-content');
        const btnToggleScratchpad = document.getElementById('btn-toggle-scratchpad');
        if (scratchpadBody && scratchpadBody.classList.contains('hidden')) {
            scratchpadBody.classList.remove('hidden');
            if (btnToggleScratchpad) btnToggleScratchpad.innerHTML = 'Thu gọn bảng nháp ▴';
        }

        const autoIntro = `Chào em! Thầy/Cô đã nạp bài tập bổ trợ rèn luyện: **$${prob}$**.\n\n🎯 Mục tiêu: Giúp em làm chủ dạng bài này mà không bao giờ bị nhầm lẫn nữa. Em hãy thử biến đổi bước đầu tiên vào **Bảng nháp** phía trên hoặc bấm **Gợi ý 1** nhé!`;
        appendSocraticBubble('model', autoIntro);
        socraticMessageLog.push({ role: 'model', text: autoIntro });
    };

    // ========================================================
    // MỤC 2: INTERACTIVE SCRATCHPAD CONTROLLER (CHẤM NHÁP TẠI CHỖ)
    // ========================================================
    const btnToggleScratchpad = document.getElementById('btn-toggle-scratchpad');
    const scratchpadToggleHeader = document.getElementById('scratchpad-toggle-header');
    const scratchpadBodyContent = document.getElementById('scratchpad-body-content');
    const scratchpadTextInput = document.getElementById('scratchpad-text-input');
    const scratchpadFileInput = document.getElementById('scratchpad-file-input');
    const scratchpadImgName = document.getElementById('scratchpad-img-name');
    const btnVerifyScratchpad = document.getElementById('btn-verify-scratchpad');
    const scratchpadEvalResult = document.getElementById('scratchpad-eval-result');

    let scratchpadUploadedImageBase64 = null;

    function toggleScratchpad(forceOpen = null) {
        if (!scratchpadBodyContent) return;
        const willOpen = forceOpen !== null ? forceOpen : scratchpadBodyContent.classList.contains('hidden');
        scratchpadBodyContent.classList.toggle('hidden', !willOpen);
        if (btnToggleScratchpad) {
            btnToggleScratchpad.innerHTML = willOpen ? 'Thu gọn bảng nháp ▴' : 'Mở rộng bảng nháp ▾';
        }
        if (willOpen && scratchpadTextInput) {
            setTimeout(() => scratchpadTextInput.focus(), 100);
        }
    }

    if (btnToggleScratchpad) btnToggleScratchpad.addEventListener('click', (e) => { e.stopPropagation(); toggleScratchpad(); });
    if (scratchpadToggleHeader) scratchpadToggleHeader.addEventListener('click', () => toggleScratchpad());

    // Bàn phím ký hiệu toán học nhanh
    document.querySelectorAll('.math-key-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const latex = btn.getAttribute('data-latex');
            if (!scratchpadTextInput || !latex) return;
            const start = scratchpadTextInput.selectionStart || scratchpadTextInput.value.length;
            const end = scratchpadTextInput.selectionEnd || scratchpadTextInput.value.length;
            const val = scratchpadTextInput.value;
            scratchpadTextInput.value = val.substring(0, start) + latex + val.substring(end);
            scratchpadTextInput.focus();
            scratchpadTextInput.selectionStart = scratchpadTextInput.selectionEnd = start + latex.length;
        });
    });

    // Tải ảnh giấy nháp bài làm
    if (scratchpadFileInput) {
        scratchpadFileInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                scratchpadUploadedImageBase64 = ev.target.result;
                if (scratchpadImgName) {
                    scratchpadImgName.innerHTML = `✓ ${escapeHtml(file.name)} (${Math.round(file.size / 1024)} KB)`;
                }
                const btnCropScratchpad = document.getElementById('btn-crop-scratchpad');
                if (btnCropScratchpad) {
                    btnCropScratchpad.classList.remove('hidden');
                    btnCropScratchpad.onclick = () => {
                        openImageCropper('scratchpad');
                    };
                }
                showToast(`Đã nhận ảnh giấy nháp: ${file.name}`, 'info');
            };
            reader.readAsDataURL(file);
        });
    }

    // Chấm nháp làm lại tại chỗ
    if (btnVerifyScratchpad) {
        btnVerifyScratchpad.addEventListener('click', async () => {
            const textVal = scratchpadTextInput ? scratchpadTextInput.value.trim() : '';
            if (!textVal && !scratchpadUploadedImageBase64) {
                showToast('⚠️ Vui lòng gõ lời giải làm lại hoặc tải ảnh giấy nháp trước nhé!', 'warning');
                if (scratchpadTextInput) scratchpadTextInput.focus();
                return;
            }

            const problem = socraticProblemInput ? socraticProblemInput.value.trim() : '';
            btnVerifyScratchpad.disabled = true;
            btnVerifyScratchpad.innerHTML = '⏳ Đang chấm nháp...';

            if (scratchpadEvalResult) {
                scratchpadEvalResult.className = 'scratchpad-result-box progress';
                scratchpadEvalResult.innerHTML = '<strong>⏳ Gia sư AI đang phân tích phép biến đổi làm lại của em...</strong>';
                scratchpadEvalResult.classList.remove('hidden');
            }

            try {
                const resp = await fetch('/api/tutor/verify-scratchpad', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        problem,
                        context: socraticActiveContext,
                        scratchpadText: textVal,
                        scratchpadImage: scratchpadUploadedImageBase64,
                    })
                });

                const evalData = await resp.json();
                btnVerifyScratchpad.disabled = false;
                btnVerifyScratchpad.innerHTML = '🎯 Chấm lời giải làm lại';

                if (evalData.success) {
                    const statusClass = evalData.isCorrect ? 'correct' : (evalData.isProgress ? 'progress' : 'incorrect');
                    scratchpadEvalResult.className = `scratchpad-result-box ${statusClass}`;
                    scratchpadEvalResult.innerHTML = `
                        <div style="font-weight: 800; font-size: 14px; margin-bottom: 4px;">
                            ${escapeHtml(evalData.evaluationTitle)}
                        </div>
                        <div style="margin-top: 4px;">${formatMathText(evalData.feedback)}</div>
                        ${evalData.nextAdvice ? `<div style="margin-top: 6px; font-weight: 600;">👉 ${formatMathText(evalData.nextAdvice)}</div>` : ''}
                    `;
                    scratchpadEvalResult.classList.remove('hidden');

                    // Đồng thời gửi vào luồng đàm thoại để học sinh tiện theo dõi
                    const chatLogEntry = `**[KẾT QUẢ THỬ SỨC LÀM LẠI]**\n${evalData.evaluationTitle}\n\n${evalData.feedback}\n\n👉 *${evalData.nextAdvice || ''}*`;
                    appendSocraticBubble('model', chatLogEntry, evalData.isCorrect ? 'hint1' : 'hint2');
                    socraticMessageLog.push({ role: 'model', text: chatLogEntry });

                    if (evalData.isCorrect) {
                        recordGrowthActivity('correct', 'Tự sửa đúng bài làm trên bảng nháp', problem || 'Phép biến đổi toán học', 40);
                        showToast('🎉 Chúc mừng em! Phép biến đổi làm lại hoàn toàn chính xác! (+40 XP)', 'success');
                    } else if (evalData.isProgress) {
                        recordGrowthActivity('attempt', 'Thử sức làm lại và có tiến bộ', problem || 'Phép biến đổi toán học', 20);
                        showToast('💡 Rất khen ngợi em đã thử sức! Hãy xem gợi ý để hoàn thiện tiếp nhé. (+20 XP)', 'info');
                    } else {
                        recordGrowthActivity('attempt', 'Thử sức làm lại trên bảng nháp', problem || 'Phép biến đổi toán học', 10);
                        showToast('💡 Rất khen ngợi em đã thử sức! Hãy xem gợi ý để hoàn thiện tiếp nhé. (+10 XP)', 'info');
                    }

                    // Render KaTeX for result
                    if (window.renderMathInElement) {
                        window.renderMathInElement(scratchpadEvalResult, {
                            delimiters: [
                                {left: '$$', right: '$$', display: true},
                                {left: '\\[', right: '\\]', display: true},
                                {left: '$', right: '$', display: false},
                                {left: '\\(', right: '\\)', display: false}
                            ],
                            throwOnError: false
                        });
                    }
                } else {
                    scratchpadEvalResult.innerHTML = `⚠️ ${escapeHtml(evalData.message || 'Chưa thể đánh giá lúc này.')}`;
                }
            } catch (err) {
                btnVerifyScratchpad.disabled = false;
                btnVerifyScratchpad.innerHTML = '🎯 Chấm lời giải làm lại';
                if (scratchpadEvalResult) {
                    scratchpadEvalResult.innerHTML = '⚠️ Lỗi kết nối mạng khi chấm nháp. Em vui lòng bấm thử lại nhé!';
                }
            }
        });
    }

    // Event listeners
    if (btnOpenSocraticTutor) btnOpenSocraticTutor.addEventListener('click', () => openSocraticTutor());
    if (cardFeatureTutor) cardFeatureTutor.addEventListener('click', () => openSocraticTutor());
    if (btnCloseSocraticModal) btnCloseSocraticModal.addEventListener('click', closeSocraticTutor);

    if (btnSocraticHint1) btnSocraticHint1.addEventListener('click', () => requestSocraticHint('hint1'));
    if (btnSocraticHint2) btnSocraticHint2.addEventListener('click', () => requestSocraticHint('hint2'));
    if (btnSocraticHint3) btnSocraticHint3.addEventListener('click', () => requestSocraticHint('hint3'));

    if (btnSocraticSend) btnSocraticSend.addEventListener('click', () => sendSocraticChatMessage());
    if (socraticUserMsgInput) {
        socraticUserMsgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendSocraticChatMessage();
            }
        });
    }

    if (btnClearSocraticChat) {
        btnClearSocraticChat.addEventListener('click', () => {
            socraticMessageLog = [];
            if (socraticChatHistory) {
                socraticChatHistory.innerHTML = `
                    <div class="socratic-welcome-card" id="socratic-welcome-card">
                        <div style="font-size: 32px; margin-bottom: 8px;">👋🤖</div>
                        <h4 style="font-size: 15px; font-weight: 800; color: #1e3a8a; margin-bottom: 4px;">Chào em! Thầy/Cô Matsuda AI đã sẵn sàng đồng hành cùng em.</h4>
                        <p style="font-size: 13px; color: #475569; max-width: 540px; margin: 0 auto 12px; line-height: 1.5;">
                            Thầy/Cô sẽ <strong>không giải hộ</strong> để em chép, mà sẽ gợi mở từng nấc giúp em tự hiểu bản chất và làm chủ phương pháp giải. Hãy bấm 1 trong 3 nút gợi ý phía trên hoặc đặt câu hỏi phía dưới nhé!
                        </p>
                        <div class="socratic-quick-chips">
                            <button type="button" class="socratic-chip" data-query="Thầy/Cô cho em hỏi bài này em nên bắt đầu biến đổi từ đâu ạ?">❓ Em nên bắt đầu từ đâu?</button>
                            <button type="button" class="socratic-chip" data-query="Nhắc lại giúp em quy tắc dấu khi nâng lũy thừa của số âm với ạ!">📖 Quy tắc dấu lũy thừa?</button>
                            <button type="button" class="socratic-chip" data-query="Làm sao để nhận biết cơ số nào cần phân tích ra thừa số nguyên tố ạ?">🔍 Phân tích thừa số nguyên tố?</button>
                        </div>
                    </div>
                `;
                bindSocraticChips();
            }
            showToast('Đã làm mới khung trao đổi với Gia sư AI!', 'info');
        });
    }

    function bindSocraticChips() {
        document.querySelectorAll('.socratic-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const query = chip.getAttribute('data-query');
                if (query) sendSocraticChatMessage(query);
            });
        });
    }
    bindSocraticChips();

    // ========================================================
    // MỤC 3: TÁCH BIỆT 2 CHẾ ĐỘ: HỌC SINH VS TRỢ LÝ GIÁO VIÊN
    // ========================================================
    let currentTutorMode = 'student'; // 'student' | 'teacher'
    const tabModeStudent = document.getElementById('tab-mode-student');
    const tabModeTeacher = document.getElementById('tab-mode-teacher');
    const socraticStudentControls = document.getElementById('socratic-student-controls');
    const socraticTeacherControls = document.getElementById('socratic-teacher-controls');
    const tutorModalHeading = document.getElementById('tutor-modal-heading');
    const tutorModalSubheading = document.getElementById('tutor-modal-subheading');
    const socraticProblemLabel = document.getElementById('socratic-problem-label');

    const btnTeacherGenExercises = document.getElementById('btn-teacher-gen-exercises');
    const btnTeacherParentMsg = document.getElementById('btn-teacher-parent-msg');
    const btnTeacherPedagogy = document.getElementById('btn-teacher-pedagogy');

    function switchTutorMode(mode) {
        currentTutorMode = mode;
        if (tabModeStudent) tabModeStudent.classList.toggle('active', mode === 'student');
        if (tabModeTeacher) tabModeTeacher.classList.toggle('active', mode === 'teacher');

        const scratchCard = document.getElementById('socratic-scratchpad-card');

        if (mode === 'teacher') {
            if (socraticStudentControls) socraticStudentControls.classList.add('hidden');
            if (scratchCard) scratchCard.classList.add('hidden');
            if (socraticTeacherControls) socraticTeacherControls.classList.remove('hidden');

            if (tutorModalHeading) tutorModalHeading.innerText = '👨‍🏫 Trợ Lý Giáo Viên AI';
            if (tutorModalSubheading) tutorModalSubheading.innerText = 'Soạn 3 bài tương tự • Tin nhắn Zalo phụ huynh • Phân tích sư phạm';
            if (socraticProblemLabel) socraticProblemLabel.innerText = '📝 Đề bài toán đang phân tích & soạn bài:';
            if (socraticUserMsgInput) socraticUserMsgInput.placeholder = 'Nhập yêu cầu trợ giảng (VD: Soạn thêm 2 bài hình học tương tự, soạn lời nhắc nộp bài)...';

            // Show teacher welcome card if chat empty
            const welcomeCard = document.getElementById('socratic-welcome-card');
            if (welcomeCard && socraticMessageLog.length === 0) {
                welcomeCard.innerHTML = `
                    <div style="font-size: 32px; margin-bottom: 8px;">👨‍🏫📋</div>
                    <h4 style="font-size: 15px; font-weight: 800; color: #1e3a8a; margin-bottom: 4px;">Kính chào Thầy/Cô! Trợ lý Giáo viên Matsuda AI đã sẵn sàng.</h4>
                    <p style="font-size: 13px; color: #475569; max-width: 560px; margin: 0 auto 12px; line-height: 1.5;">
                        Hệ thống giúp Thầy/Cô <strong>tiết kiệm tối đa thời gian soạn đề và báo cáo phụ huynh</strong>. Hãy bấm 1 trong 3 công cụ phía trên hoặc gõ yêu cầu cụ thể phía dưới!
                    </p>
                    <div class="socratic-quick-chips">
                        <button type="button" class="socratic-chip" data-query="Soạn giúp tôi 3 bài tập cùng dạng này với thang điểm 10 chi tiết">📚 Soạn 3 bài tập tương tự</button>
                        <button type="button" class="socratic-chip" data-query="Viết tin nhắn Zalo gửi phụ huynh thông báo kết quả và dặn dò ôn bài">💬 Soạn tin nhắn Zalo phụ huynh</button>
                        <button type="button" class="socratic-chip" data-query="Phân tích lỗi sai điển hình của học sinh và gợi ý hoạt động 5 phút đầu giờ">📊 Phân tích lỗi & Tiết sau</button>
                    </div>
                `;
                bindSocraticChips();
            }
        } else {
            // mode === 'student'
            if (socraticStudentControls) socraticStudentControls.classList.remove('hidden');
            if (scratchCard) scratchCard.classList.remove('hidden');
            if (socraticTeacherControls) socraticTeacherControls.classList.add('hidden');

            if (tutorModalHeading) tutorModalHeading.innerText = '🤖 Gia Sư Socratic AI';
            if (tutorModalSubheading) tutorModalSubheading.innerText = 'Dẫn dắt tư duy từng nấc • Gợi mở công thức • Tuyệt đối không giải hộ';
            if (socraticProblemLabel) socraticProblemLabel.innerText = '📝 Đề bài toán đang cần Gia sư hỗ trợ:';
            if (socraticUserMsgInput) socraticUserMsgInput.placeholder = 'Nhập thắc mắc hoặc câu trả lời thử sức của em (VD: Em nghĩ cơ số -4 mũ lẻ mang dấu âm đúng không ạ?)...';

            const welcomeCard = document.getElementById('socratic-welcome-card');
            if (welcomeCard && socraticMessageLog.length === 0) {
                welcomeCard.innerHTML = `
                    <div style="font-size: 32px; margin-bottom: 8px;">👋🤖</div>
                    <h4 style="font-size: 15px; font-weight: 800; color: #1e3a8a; margin-bottom: 4px;">Chào em! Thầy/Cô Matsuda AI đã sẵn sàng đồng hành cùng em.</h4>
                    <p style="font-size: 13px; color: #475569; max-width: 540px; margin: 0 auto 12px; line-height: 1.5;">
                        Thầy/Cô sẽ <strong>không giải hộ</strong> để em chép, mà sẽ gợi mở từng nấc giúp em tự hiểu bản chất và làm chủ phương pháp giải. Hãy bấm 1 trong 3 nút gợi ý phía trên hoặc đặt câu hỏi phía dưới nhé!
                    </p>
                    <div class="socratic-quick-chips">
                        <button type="button" class="socratic-chip" data-query="Thầy/Cô cho em hỏi bài này em nên bắt đầu biến đổi từ đâu ạ?">❓ Em nên bắt đầu từ đâu?</button>
                        <button type="button" class="socratic-chip" data-query="Nhắc lại giúp em quy tắc dấu khi nâng lũy thừa của số âm với ạ!">📖 Quy tắc dấu lũy thừa?</button>
                        <button type="button" class="socratic-chip" data-query="Làm sao để nhận biết cơ số nào cần phân tích ra thừa số nguyên tố ạ?">🔍 Phân tích thừa số nguyên tố?</button>
                    </div>
                `;
                bindSocraticChips();
            }
        }
    }

    if (tabModeStudent) tabModeStudent.addEventListener('click', () => switchTutorMode('student'));
    if (tabModeTeacher) tabModeTeacher.addEventListener('click', () => switchTutorMode('teacher'));

    async function requestTeacherAssist(action) {
        const problem = socraticProblemInput ? socraticProblemInput.value.trim() : '';
        if (!problem && !socraticActiveContext) {
            showToast('⚠️ Vui lòng nhập đề bài hoặc mở bài vừa chấm trước nhé!', 'warning');
            if (socraticProblemInput) socraticProblemInput.focus();
            return;
        }

        const actionTitles = {
            'generate_exercises': '📚 Yêu cầu: Soạn 3 bài tập tương tự phân hóa',
            'parent_message': '💬 Yêu cầu: Viết tin nhắn nhận xét gửi Phụ huynh',
            'pedagogical_analysis': '📊 Yêu cầu: Phân tích lỗi sai điển hình & Tiết học sau'
        };

        const actionTitle = actionTitles[action] || 'Yêu cầu Trợ lý Giáo viên';
        appendSocraticBubble('user', actionTitle);
        socraticMessageLog.push({ role: 'user', text: actionTitle });

        showSocraticTyping('👨‍🏫 Trợ lý Giáo viên AI đang soạn thảo chuẩn mực...');

        let teacherName = 'Thầy/Cô Toán Matsuda';
        let schoolName = '';
        try {
            const rawB = localStorage.getItem('matsuda_branding_info');
            if (rawB) {
                const b = JSON.parse(rawB);
                if (b.teacherName) teacherName = b.teacherName;
                if (b.schoolName) schoolName = b.schoolName;
            }
        } catch (e) {}

        let studentName = 'Em học sinh';
        if (currentGradingData && currentGradingData.studentName) {
            studentName = currentGradingData.studentName;
        }

        try {
            const resp = await fetch('/api/tutor/teacher-assist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    problem,
                    context: socraticActiveContext,
                    studentName,
                    teacherName,
                    schoolName
                })
            });

            const data = await resp.json();
            removeSocraticTyping();

            if (data.success && data.reply) {
                appendSocraticBubble('model', data.reply, action === 'generate_exercises' ? 'teacher1' : (action === 'parent_message' ? 'teacher2' : 'teacher3'));
                socraticMessageLog.push({ role: 'model', text: data.reply });
            } else {
                appendSocraticBubble('model', data.message || 'Hệ thống trợ giảng tạm thời chưa phản hồi, Thầy/Cô vui lòng bấm lại nhé!');
            }
        } catch (err) {
            removeSocraticTyping();
            appendSocraticBubble('model', '⚠️ Kết nối mạng bị gián đoạn. Thầy/Cô vui lòng bấm thử lại nhé!');
        }
    }

    if (btnTeacherGenExercises) btnTeacherGenExercises.addEventListener('click', () => requestTeacherAssist('generate_exercises'));
    if (btnTeacherParentMsg) btnTeacherParentMsg.addEventListener('click', () => requestTeacherAssist('parent_message'));
    if (btnTeacherPedagogy) btnTeacherPedagogy.addEventListener('click', () => requestTeacherAssist('pedagogical_analysis'));

    // ========================================================
    // MỤC 4: NHẬT KÝ TỰ HỌC & ĐO LƯỜNG SỰ TIẾN BỘ (GROWTH TRACKER)
    // ========================================================
    const GROWTH_STORAGE_KEY = 'matsuda_learning_growth';

    const BADGES_CONFIG = [
        {
            id: 'persistence',
            name: 'Chiến Binh Kiên Trì',
            icon: '🛡️',
            desc: 'Không nản lòng, thử sức làm lại ít nhất 1 lần trên Bảng nháp',
            check: (data) => (data.attemptCount || 0) >= 1
        },
        {
            id: 'self_correction',
            name: 'Bậc Thầy Tự Sửa Lỗi',
            icon: '⚡',
            desc: 'Tự sửa đúng hoàn toàn lỗi sai cũ mà không cần chép lời giải',
            check: (data) => (data.solvedCount || 0) >= 1
        },
        {
            id: 'math_conqueror',
            name: 'Vượt Ải Toán Học',
            icon: '🏆',
            desc: 'Tự sửa đúng và vượt qua từ 3 bài toán / bước nháp trở lên',
            check: (data) => (data.solvedCount || 0) >= 3
        },
        {
            id: 'socratic_thinker',
            name: 'Tư Duy Socratic',
            icon: '💡',
            desc: 'Khám phá từ 5 gợi ý sư phạm để tự tìm ra hướng giải',
            check: (data) => (data.hintsViewed || 0) >= 5
        },
        {
            id: 'growth_champion',
            name: 'Học Giả Tinh Anh',
            icon: '👑',
            desc: 'Đạt từ 250 điểm tích lũy tiến bộ (Growth XP)',
            check: (data) => (data.xp || 0) >= 250
        }
    ];

    function getGrowthData() {
        try {
            const raw = localStorage.getItem(GROWTH_STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return {
            xp: 0,
            solvedCount: 0,
            attemptCount: 0,
            hintsViewed: 0,
            unlockedBadges: [],
            badgeUnlockDates: {},
            activityLog: []
        };
    }

    function saveGrowthData(data) {
        try {
            localStorage.setItem(GROWTH_STORAGE_KEY, JSON.stringify(data));
        } catch (e) {}
        updateNavbarGrowthBadge();
    }

    function updateNavbarGrowthBadge() {
        const badgeEl = document.getElementById('growth-badge-count');
        if (!badgeEl) return;
        const data = getGrowthData();
        const unlockedCount = (data.unlockedBadges || []).length;
        badgeEl.innerText = `${unlockedCount}/5`;
    }
    updateNavbarGrowthBadge();

    function recordGrowthActivity(type, title, detail, xpGain) {
        const data = getGrowthData();
        data.xp = (data.xp || 0) + xpGain;
        if (type === 'correct') {
            data.solvedCount = (data.solvedCount || 0) + 1;
            data.attemptCount = (data.attemptCount || 0) + 1;
        } else if (type === 'attempt') {
            data.attemptCount = (data.attemptCount || 0) + 1;
        } else if (type === 'hint') {
            data.hintsViewed = (data.hintsViewed || 0) + 1;
        }

        if (!data.unlockedBadges) data.unlockedBadges = [];
        if (!data.badgeUnlockDates) data.badgeUnlockDates = {};

        // Check for new badges
        let newBadgeUnlocked = false;
        BADGES_CONFIG.forEach(b => {
            if (!data.unlockedBadges.includes(b.id) && b.check(data)) {
                data.unlockedBadges.push(b.id);
                data.badgeUnlockDates[b.id] = new Date().toLocaleDateString('vi-VN');
                showToast(`🏅 HUY HIỆU MỚI: [${b.name}]! Chúc mừng em đã tiến bộ vượt bậc! 🎉`, 'success');
                newBadgeUnlocked = true;
            }
        });

        if (newBadgeUnlocked || type === 'correct') {
            triggerCelebrationConfetti();
        }

        // Add to activity log (max 30 entries)
        if (!data.activityLog) data.activityLog = [];
        data.activityLog.unshift({
            id: 'act_' + Date.now(),
            timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
            type,
            title,
            detail: detail.length > 80 ? detail.substring(0, 80) + '...' : detail,
            xp: xpGain
        });
        if (data.activityLog.length > 30) data.activityLog.pop();

        saveGrowthData(data);
        renderGrowthTrackerUI();
    }

    const growthModal = document.getElementById('growth-tracker-modal');
    const btnOpenGrowthTracker = document.getElementById('btn-open-growth-tracker');
    const cardFeatureGrowth = document.getElementById('card-feature-growth');
    const btnSocraticToGrowth = document.getElementById('btn-socratic-to-growth');
    const btnCloseGrowthModal = document.getElementById('btn-close-growth-modal');
    const btnResetGrowthData = document.getElementById('btn-reset-growth-data');
    const btnExportGrowthSummary = document.getElementById('btn-export-growth-summary');

    function openGrowthTrackerModal() {
        if (!growthModal) return;
        renderGrowthTrackerUI();
        growthModal.classList.remove('hidden');
    }

    function closeGrowthTrackerModal() {
        if (growthModal) growthModal.classList.add('hidden');
    }

    function renderGrowthTrackerUI() {
        const data = getGrowthData();

        // Level calculation
        const xp = data.xp || 0;
        let rankTitle = 'Người Khám Phá';
        let avatarIcon = '🌱';
        let nextXP = 100;
        let prevXP = 0;

        if (xp >= 500) {
            rankTitle = 'Học Giả Toán Học Tinh Anh';
            avatarIcon = '👑';
            nextXP = 500;
            prevXP = 500;
        } else if (xp >= 250) {
            rankTitle = 'Bậc Thầy Tư Duy Socratic';
            avatarIcon = '🌟';
            nextXP = 500;
            prevXP = 250;
        } else if (xp >= 100) {
            rankTitle = 'Nhà Toán Học Kiên Định';
            avatarIcon = '🚀';
            nextXP = 250;
            prevXP = 100;
        }

        const rankTitleEl = document.getElementById('growth-rank-title');
        const rankAvatarEl = document.getElementById('growth-rank-avatar');
        const xpBarEl = document.getElementById('growth-xp-bar');
        const xpTextEl = document.getElementById('growth-xp-text');

        if (rankTitleEl) rankTitleEl.innerText = rankTitle;
        if (rankAvatarEl) rankAvatarEl.innerText = avatarIcon;

        const progressPercent = nextXP === prevXP ? 100 : Math.min(100, Math.max(0, ((xp - prevXP) / (nextXP - prevXP)) * 100));
        if (xpBarEl) xpBarEl.style.width = `${progressPercent}%`;
        if (xpTextEl) {
            xpTextEl.innerText = nextXP === prevXP 
                ? `Đạt cấp độ tối đa (${xp} XP) 👑` 
                : `${xp} / ${nextXP} XP (${nextXP - xp} XP nữa để lên cấp)`;
        }

        // Stats
        const elSolved = document.getElementById('growth-stat-solved');
        const elHints = document.getElementById('growth-stat-hints');
        const elRate = document.getElementById('growth-stat-rate');
        const elBadges = document.getElementById('growth-stat-badges');

        if (elSolved) elSolved.innerText = data.solvedCount || 0;
        if (elHints) elHints.innerText = data.hintsViewed || 0;

        const attempts = data.attemptCount || 0;
        const rate = attempts > 0 ? Math.round(((data.solvedCount || 0) / attempts) * 100) : 0;
        if (elRate) elRate.innerText = `${rate}%`;

        const unlockedBadges = data.unlockedBadges || [];
        if (elBadges) elBadges.innerText = `${unlockedBadges.length}/${BADGES_CONFIG.length}`;

        // Render Badges
        const badgesContainer = document.getElementById('growth-badges-container');
        if (badgesContainer) {
            let bHtml = '';
            BADGES_CONFIG.forEach(b => {
                const isUnlocked = unlockedBadges.includes(b.id);
                const unlockDate = (data.badgeUnlockDates || {})[b.id];
                bHtml += `
                    <div class="growth-badge-card ${isUnlocked ? 'unlocked' : 'locked'}">
                        <div class="badge-card-icon">${isUnlocked ? b.icon : '🔒'}</div>
                        <div class="badge-card-info">
                            <div class="badge-card-name">${escapeHtml(b.name)}</div>
                            <div class="badge-card-desc">${escapeHtml(b.desc)}</div>
                            <span class="badge-card-status ${isUnlocked ? 'achieved' : 'pending'}">
                                ${isUnlocked ? `✓ Đã đạt ${unlockDate ? `(${unlockDate})` : ''}` : 'Chưa đạt'}
                            </span>
                        </div>
                    </div>
                `;
            });
            badgesContainer.innerHTML = bHtml;
        }

        // Render Activity Log
        const logContainer = document.getElementById('growth-log-container');
        if (logContainer) {
            const logs = data.activityLog || [];
            if (logs.length === 0) {
                logContainer.innerHTML = `
                    <div style="text-align: center; color: #94a3b8; padding: 20px 0; font-size: 13px;">
                        🌱 Chưa có hoạt động nào. Hãy thử giải bài nháp hoặc bấm Gợi ý Socratic để bắt đầu tích lũy XP nhé!
                    </div>
                `;
            } else {
                let lHtml = '';
                logs.forEach(l => {
                    const tagClass = l.type === 'correct' ? 'correct' : 'hint';
                    const tagLabel = l.type === 'correct' ? '✓ Tự sửa đúng' : (l.type === 'attempt' ? '✏️ Thử sức' : '💡 Xem gợi ý');
                    lHtml += `
                        <div class="growth-log-item">
                            <div class="growth-log-left">
                                <span class="growth-log-tag ${tagClass}">${tagLabel}</span>
                                <div>
                                    <strong style="color: #1e293b;">${escapeHtml(l.title)}</strong>
                                    <div style="color: #64748b; font-size: 11px;">${escapeHtml(l.detail)} • <span style="color: #94a3b8;">${escapeHtml(l.timestamp)}</span></div>
                                </div>
                            </div>
                            <div class="growth-log-xp">+${l.xp} XP</div>
                        </div>
                    `;
                });
                logContainer.innerHTML = lHtml;
            }
        }
    }

    if (btnOpenGrowthTracker) btnOpenGrowthTracker.addEventListener('click', openGrowthTrackerModal);
    if (cardFeatureGrowth) cardFeatureGrowth.addEventListener('click', openGrowthTrackerModal);
    if (btnSocraticToGrowth) btnSocraticToGrowth.addEventListener('click', () => {
        closeSocraticTutor();
        openGrowthTrackerModal();
    });
    if (btnCloseGrowthModal) btnCloseGrowthModal.addEventListener('click', closeGrowthTrackerModal);

    if (btnResetGrowthData) {
        btnResetGrowthData.addEventListener('click', () => {
            if (confirm('Em có chắc chắn muốn làm mới lại dữ liệu Nhật ký tự học và Huy hiệu không?')) {
                localStorage.removeItem(GROWTH_STORAGE_KEY);
                renderGrowthTrackerUI();
                updateNavbarGrowthBadge();
                showToast('Đã làm mới dữ liệu Nhật ký tự học!', 'info');
            }
        });
    }

    if (btnExportGrowthSummary) {
        btnExportGrowthSummary.addEventListener('click', () => {
            const data = getGrowthData();
            const unlocked = (data.unlockedBadges || []).length;
            const text = `📊 BÁO CÁO TIẾN BỘ TỰ HỌC - TOÁN MATSUDA AI
• Điểm tích lũy tiến bộ: ${data.xp || 0} XP
• Cấp độ đạt được: ${(data.xp || 0) >= 500 ? 'Học Giả Tinh Anh 👑' : (data.xp || 0) >= 250 ? 'Bậc Thầy Tư Duy Socratic 🌟' : (data.xp || 0) >= 100 ? 'Nhà Toán Học Kiên Định 🚀' : 'Người Khám Phá 🌱'}
• Số lỗi sai đã tự sửa: ${data.solvedCount || 0} bài
• Số gợi ý sư phạm đã khám phá: ${data.hintsViewed || 0} lần
• Huy hiệu đạt được: ${unlocked}/5 (${(data.unlockedBadges || []).map(id => BADGES_CONFIG.find(b=>b.id===id)?.name).filter(Boolean).join(', ') || 'Đang chinh phục'})
(Tạo tự động từ nền tảng Toán Matsuda AI)`;

            navigator.clipboard.writeText(text).then(() => {
                showToast('📋 Đã sao chép báo cáo tiến bộ vào bộ nhớ tạm!', 'success');
            }).catch(() => {
                showToast('Không thể sao chép tự động.', 'error');
            });
        });
    }

    // ========================================================
    // TỐI ƯU TRẢI NGHIỆM: HIỆU ỨNG CHÚC MỪNG & ĐÓNG MODAL TIỆN LỢI
    // ========================================================
    function triggerCelebrationConfetti() {
        const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#10b981'];
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.inset = '0';
        container.style.pointerEvents = 'none';
        container.style.zIndex = '999999';
        container.style.overflow = 'hidden';
        document.body.appendChild(container);

        for (let i = 0; i < 36; i++) {
            const piece = document.createElement('div');
            const size = Math.random() * 8 + 6;
            piece.style.position = 'absolute';
            piece.style.width = `${size}px`;
            piece.style.height = `${size * 0.6}px`;
            piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            piece.style.borderRadius = '2px';
            piece.style.left = `${Math.random() * 100}%`;
            piece.style.top = '-10px';
            piece.style.opacity = '1';

            const duration = Math.random() * 1.4 + 1.2;
            const delay = Math.random() * 0.3;
            const xOffset = (Math.random() - 0.5) * 180;

            piece.animate([
                { transform: `translate(0, 0) rotate(0deg)`, opacity: 1 },
                { transform: `translate(${xOffset}px, ${window.innerHeight + 20}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }
            ], {
                duration: duration * 1000,
                delay: delay * 1000,
                easing: 'cubic-bezier(0.25, 1, 0.5, 1)'
            });

            container.appendChild(piece);
        }

        setTimeout(() => {
            container.remove();
        }, 2600);
    }

    // Đóng Modal khi bấm phím Escape (ESC)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (socraticModal && !socraticModal.classList.contains('hidden')) {
                closeSocraticTutor();
            } else if (growthModal && !growthModal.classList.contains('hidden')) {
                closeGrowthTrackerModal();
            }
        }
    });

    // Đóng Modal khi bấm ra ngoài nền mờ (Backdrop click)
    if (socraticModal) {
        socraticModal.addEventListener('click', (e) => {
            if (e.target === socraticModal) closeSocraticTutor();
        });
    }
    if (growthModal) {
        growthModal.addEventListener('click', (e) => {
            if (e.target === growthModal) closeGrowthTrackerModal();
        });
    }

    // ========================================================
    // TÍNH NĂNG CẮT & KHOANH VÙNG BÀI LÀM (INTERACTIVE CROPPER)
    // ========================================================
    const cropperModal = document.getElementById('image-cropper-modal');
    const cropperCanvas = document.getElementById('cropper-canvas');
    const cropperBox = document.getElementById('cropper-box');
    const cropperViewport = document.getElementById('cropper-viewport-container');
    const btnCloseCropperModal = document.getElementById('btn-close-cropper-modal');
    const btnCancelCrop = document.getElementById('btn-cancel-crop');
    const btnApplyCrop = document.getElementById('btn-apply-crop');
    const btnCropRotateLeft = document.getElementById('btn-crop-rotate-left');
    const btnCropRotateRight = document.getElementById('btn-crop-rotate-right');
    const btnCropSelectAll = document.getElementById('btn-crop-select-all');
    const btnCropResetOrig = document.getElementById('btn-crop-reset-orig');

    let cropperTargetType = 'page'; // 'page' | 'scratchpad'
    let cropperTargetPageIndex = 0;
    let cropperCurrentRotation = 0;
    let cropperLoadedImage = null;

    let cropRect = { x: 0, y: 0, w: 100, h: 100 };
    let isDraggingCropBox = false;
    let activeCropHandle = null;
    let dragStartPointer = { x: 0, y: 0 };
    let dragStartRect = { x: 0, y: 0, w: 0, h: 0 };
    let cropperDispMetrics = { dispW: 100, dispH: 100, offsetLeft: 0, offsetTop: 0 };

    function openImageCropper(targetType = 'page', pageIdx = 0) {
        if (!cropperModal || !cropperCanvas || !cropperBox) return;

        cropperTargetType = targetType;
        cropperTargetPageIndex = pageIdx;

        let srcUrl = '';
        if (targetType === 'page') {
            const page = uploadedPages[pageIdx];
            if (!page) return;
            if (!page.rawOriginalDataUrl) {
                page.rawOriginalDataUrl = page.originalDataUrl;
            }
            srcUrl = page.displayDataUrl || page.originalDataUrl;
            cropperCurrentRotation = page.rotation || 0;
        } else {
            srcUrl = scratchpadUploadedImageBase64;
            cropperCurrentRotation = 0;
        }

        if (!srcUrl) {
            showToast('⚠️ Không tìm thấy ảnh để cắt khoanh vùng.', 'warning');
            return;
        }

        cropperModal.classList.remove('hidden');

        cropperLoadedImage = new Image();
        cropperLoadedImage.onload = () => {
            renderCropperCanvas(true);
        };
        cropperLoadedImage.src = srcUrl;
    }

    function closeImageCropper() {
        if (cropperModal) cropperModal.classList.add('hidden');
        cropperLoadedImage = null;
    }

    function renderCropperCanvas(resetBox = false) {
        if (!cropperLoadedImage || !cropperCanvas || !cropperViewport) return;

        const ctx = cropperCanvas.getContext('2d');
        const rot = ((cropperCurrentRotation % 360) + 360) % 360;
        const isSideways = (rot === 90 || rot === 270);

        const natW = cropperLoadedImage.naturalWidth;
        const natH = cropperLoadedImage.naturalHeight;

        cropperCanvas.width = isSideways ? natH : natW;
        cropperCanvas.height = isSideways ? natW : natH;

        ctx.save();
        ctx.translate(cropperCanvas.width / 2, cropperCanvas.height / 2);
        ctx.rotate((rot * Math.PI) / 180);
        ctx.drawImage(cropperLoadedImage, -natW / 2, -natH / 2);
        ctx.restore();

        const containerW = cropperViewport.clientWidth || 600;
        const containerH = cropperViewport.clientHeight || 400;

        const scale = Math.min((containerW - 32) / cropperCanvas.width, (containerH - 32) / cropperCanvas.height);
        const dispW = Math.max(80, Math.round(cropperCanvas.width * scale));
        const dispH = Math.max(80, Math.round(cropperCanvas.height * scale));

        cropperCanvas.style.width = dispW + 'px';
        cropperCanvas.style.height = dispH + 'px';

        const offsetLeft = Math.round((containerW - dispW) / 2);
        const offsetTop = Math.round((containerH - dispH) / 2);

        cropperDispMetrics = { dispW, dispH, offsetLeft, offsetTop };

        if (resetBox) {
            cropRect = {
                x: Math.round(dispW * 0.05),
                y: Math.round(dispH * 0.05),
                w: Math.round(dispW * 0.9),
                h: Math.round(dispH * 0.9)
            };
        } else {
            cropRect.x = Math.max(0, Math.min(dispW - cropRect.w, cropRect.x));
            cropRect.y = Math.max(0, Math.min(dispH - cropRect.h, cropRect.y));
            cropRect.w = Math.min(dispW, cropRect.w);
            cropRect.h = Math.min(dispH, cropRect.h);
        }

        updateCropBoxUI();
    }

    function updateCropBoxUI() {
        if (!cropperBox) return;
        cropperBox.style.left = (cropperDispMetrics.offsetLeft + cropRect.x) + 'px';
        cropperBox.style.top = (cropperDispMetrics.offsetTop + cropRect.y) + 'px';
        cropperBox.style.width = cropRect.w + 'px';
        cropperBox.style.height = cropRect.h + 'px';
    }

    // Dragging & Resizing crop box
    if (cropperBox) {
        cropperBox.addEventListener('pointerdown', (e) => {
            if (e.target.classList.contains('crop-handle')) {
                activeCropHandle = e.target.getAttribute('data-handle');
                isDraggingCropBox = false;
            } else {
                isDraggingCropBox = true;
                activeCropHandle = null;
            }
            dragStartPointer = { x: e.clientX, y: e.clientY };
            dragStartRect = { ...cropRect };
            e.preventDefault();
        });
    }

    window.addEventListener('pointermove', (e) => {
        if (!isDraggingCropBox && !activeCropHandle) return;

        const dx = e.clientX - dragStartPointer.x;
        const dy = e.clientY - dragStartPointer.y;
        const { dispW, dispH } = cropperDispMetrics;
        const minSize = 35;

        if (isDraggingCropBox) {
            let nextX = dragStartRect.x + dx;
            let nextY = dragStartRect.y + dy;
            nextX = Math.max(0, Math.min(dispW - cropRect.w, nextX));
            nextY = Math.max(0, Math.min(dispH - cropRect.h, nextY));
            cropRect.x = nextX;
            cropRect.y = nextY;
        } else if (activeCropHandle) {
            let { x, y, w, h } = dragStartRect;

            if (activeCropHandle.includes('e')) {
                w = Math.max(minSize, Math.min(dispW - x, dragStartRect.w + dx));
            }
            if (activeCropHandle.includes('s')) {
                h = Math.max(minSize, Math.min(dispH - y, dragStartRect.h + dy));
            }
            if (activeCropHandle.includes('w')) {
                const maxDx = dragStartRect.w - minSize;
                const appliedDx = Math.max(-dragStartRect.x, Math.min(maxDx, dx));
                x = dragStartRect.x + appliedDx;
                w = dragStartRect.w - appliedDx;
            }
            if (activeCropHandle.includes('n')) {
                const maxDy = dragStartRect.h - minSize;
                const appliedDy = Math.max(-dragStartRect.y, Math.min(maxDy, dy));
                y = dragStartRect.y + appliedDy;
                h = dragStartRect.h - appliedDy;
            }

            cropRect = { x, y, w, h };
        }

        updateCropBoxUI();
    });

    window.addEventListener('pointerup', () => {
        isDraggingCropBox = false;
        activeCropHandle = null;
    });

    // Rotate inside cropper
    if (btnCropRotateLeft) {
        btnCropRotateLeft.addEventListener('click', () => {
            cropperCurrentRotation = ((cropperCurrentRotation - 90) % 360 + 360) % 360;
            renderCropperCanvas(true);
        });
    }
    if (btnCropRotateRight) {
        btnCropRotateRight.addEventListener('click', () => {
            cropperCurrentRotation = (cropperCurrentRotation + 90) % 360;
            renderCropperCanvas(true);
        });
    }

    // Select full image
    if (btnCropSelectAll) {
        btnCropSelectAll.addEventListener('click', () => {
            const { dispW, dispH } = cropperDispMetrics;
            cropRect = { x: 0, y: 0, w: dispW, dispH };
            updateCropBoxUI();
        });
    }

    // Reset to raw original
    if (btnCropResetOrig) {
        btnCropResetOrig.addEventListener('click', () => {
            if (cropperTargetType === 'page') {
                const page = uploadedPages[cropperTargetPageIndex];
                if (page && page.rawOriginalDataUrl) {
                    page.displayDataUrl = page.rawOriginalDataUrl;
                    page.isCropped = false;
                    page.rotation = 0;
                    cropperCurrentRotation = 0;
                    cropperLoadedImage = new Image();
                    cropperLoadedImage.onload = () => renderCropperCanvas(true);
                    cropperLoadedImage.src = page.rawOriginalDataUrl;
                    showToast('Đã khôi phục lại ảnh chụp ban đầu.', 'info');
                }
            } else {
                showToast('Đã đặt lại vùng chọn.', 'info');
                renderCropperCanvas(true);
            }
        });
    }

    // Apply crop
    if (btnApplyCrop) {
        btnApplyCrop.addEventListener('click', () => {
            if (!cropperCanvas) return;

            const { dispW, dispH } = cropperDispMetrics;
            const scaleX = cropperCanvas.width / dispW;
            const scaleY = cropperCanvas.height / dispH;

            const sx = Math.max(0, Math.round(cropRect.x * scaleX));
            const sy = Math.max(0, Math.round(cropRect.y * scaleY));
            const sw = Math.min(cropperCanvas.width - sx, Math.round(cropRect.w * scaleX));
            const sh = Math.min(cropperCanvas.height - sy, Math.round(cropRect.h * scaleY));

            if (sw <= 10 || sh <= 10) {
                showToast('⚠️ Vùng chọn quá nhỏ, vui lòng kéo rộng hơn.', 'warning');
                return;
            }

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = sw;
            tempCanvas.height = sh;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(cropperCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

            const croppedDataUrl = tempCanvas.toDataURL('image/jpeg', 0.92);

            if (cropperTargetType === 'page') {
                const page = uploadedPages[cropperTargetPageIndex];
                if (page) {
                    page.displayDataUrl = croppedDataUrl;
                    page.originalDataUrl = croppedDataUrl;
                    page.isCropped = true;
                    page.width = sw;
                    page.height = sh;
                    page.rotation = 0; // Rotated canvas was baked into cropped result
                    page.optimizedBlob = null; // Re-optimize for grading
                    renderUploadedPagesList();
                    showToast(`✂️ Đã khoanh vùng câu cần chấm cho Trang ${cropperTargetPageIndex + 1}! AI sẽ chỉ tập trung chấm phần này.`, 'success');
                }
            } else {
                scratchpadUploadedImageBase64 = croppedDataUrl;
                const scratchName = document.getElementById('scratchpad-img-name');
                if (scratchName) scratchName.innerHTML = '✓ Đã khoanh vùng ảnh nháp';
                showToast('✂️ Đã khoanh vùng phần bài làm nháp thành công!', 'success');
            }

            closeImageCropper();
        });
    }

    if (btnCloseCropperModal) btnCloseCropperModal.addEventListener('click', closeImageCropper);
    if (btnCancelCrop) btnCancelCrop.addEventListener('click', closeImageCropper);
    if (cropperModal) {
        cropperModal.addEventListener('click', (e) => {
            if (e.target === cropperModal) closeImageCropper();
        });
    }

    // Window resize -> adjust cropper
    window.addEventListener('resize', () => {
        if (cropperModal && !cropperModal.classList.contains('hidden') && cropperLoadedImage) {
            renderCropperCanvas(false);
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (cropperModal && !cropperModal.classList.contains('hidden')) {
                closeImageCropper();
            }
        }
    });
});

