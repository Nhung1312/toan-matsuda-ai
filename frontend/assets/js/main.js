/**
 * TOÁN MATSUDA AI - SPRINT 4
 * Tích hợp FastAPI + Gemini Vision
 */

document.addEventListener('DOMContentLoaded', () => {
    
    // --- DOM ELEMENTS ---
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    
    const uploadDefault = document.getElementById('upload-default');
    const uploadPreview = document.getElementById('upload-preview');
    const previewImage = document.getElementById('preview-image');
    
    const fileNameEl = document.getElementById('file-name');
    const fileSizeEl = document.getElementById('file-size');
    const fileTypeEl = document.getElementById('file-type');
    const fileDimEl = document.getElementById('file-dimensions');
    const rowDim = document.getElementById('row-dimensions');
    
    const btnReselect = document.getElementById('btn-reselect');
    const btnRemoveFile = document.getElementById('btn-remove-file');
    const btnGrade = document.getElementById('btn-grade');
    const btnResetMain = document.getElementById('btn-reset-main');

    const sectionUpload = document.getElementById('upload-section');
    const sectionResult = document.getElementById('result-section');

    // Kết quả elements
    const animatedScore = document.getElementById('animated-score');
    const scoreMarker = document.getElementById('score-marker');
    const resultSummary = document.getElementById('result-summary');
    const questionsList = document.getElementById('questions-list');
    const overallFeedbackList = document.getElementById('overall-feedback-list');

    let selectedFileUrl = null;

    // --- DRAG & DROP LOGIC ---
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    
    dropZone.addEventListener('dragover', () => {
        if(!uploadDefault.classList.contains('hidden')) {
            dropZone.classList.add('dragover');
        }
    });
    
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    
    dropZone.addEventListener('drop', (e) => {
        dropZone.classList.remove('dragover');
        if(uploadDefault.classList.contains('hidden')) return; 
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', function() { handleFiles(this.files); });

    function formatBytes(bytes) {
        if (!+bytes) return '0 Bytes';
        const k = 1024, i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${['Bytes', 'KB', 'MB', 'GB'][i]}`;
    }

    function handleFiles(files) {
        if (files.length > 0) {
            const file = files[0];
            
            fileNameEl.innerText = file.name;
            fileSizeEl.innerText = formatBytes(file.size);
            fileTypeEl.innerText = file.name.split('.').pop().toUpperCase();

            if (file.type.startsWith('image/')) {
                if(selectedFileUrl) URL.revokeObjectURL(selectedFileUrl);
                selectedFileUrl = URL.createObjectURL(file);
                previewImage.src = selectedFileUrl;
                
                const img = new Image();
                img.onload = function() {
                    fileDimEl.innerText = `${this.naturalWidth} × ${this.naturalHeight}`;
                };
                img.src = selectedFileUrl;

                rowDim.classList.remove('hidden');
                previewImage.classList.remove('hidden');
            } else {
                alert("Sprint 4 chỉ hỗ trợ nạp Ảnh cho Gemini Vision!");
                return;
            }

            // Đổi UI
            uploadDefault.classList.add('hidden');
            uploadPreview.classList.remove('hidden');
            dropZone.style.borderStyle = "solid";
            dropZone.style.borderColor = "var(--color-primary)";

            // Enable nút Chấm bài
            btnGrade.disabled = false;
            btnGrade.classList.remove('disabled-btn');
            btnGrade.style.opacity = 1;
            btnGrade.style.cursor = "pointer";
            btnGrade.classList.add('pulse-glow');
        }
    }

    btnReselect.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
    btnRemoveFile.addEventListener('click', (e) => { e.stopPropagation(); resetUploadArea(); });

    function resetUploadArea() {
        if(selectedFileUrl) { URL.revokeObjectURL(selectedFileUrl); selectedFileUrl = null; }
        fileInput.value = "";
        uploadPreview.classList.add('hidden');
        uploadDefault.classList.remove('hidden');
        dropZone.style.borderStyle = "dashed";
        dropZone.style.borderColor = "rgba(37, 99, 235, 0.3)";
        
        btnGrade.disabled = true;
        btnGrade.classList.add('disabled-btn');
        btnGrade.style.opacity = "";
        btnGrade.style.cursor = "";
        btnGrade.classList.remove('pulse-glow');
    }

    // --- SPRINT 4: GỌI API GEMINI QUA FASTAPI ---
    const modal = document.getElementById('demo-modal');
    const loadingText = document.getElementById('loading-text');
    const modalFinalMsg = document.getElementById('modal-final-msg');
    
    // Animation điểm số
    function triggerScoreAnimation(targetScore) {
        let current = 0;
        const interval = setInterval(() => {
            current += 0.1;
            if (current >= targetScore) {
                current = targetScore;
                clearInterval(interval);
            }
            animatedScore.innerText = current.toFixed(1);
        }, 15);
        
        setTimeout(() => {
            scoreMarker.style.left = `calc(${targetScore * 10}% - 10px)`; 
        }, 100);
    }

    // --- LATEX / KATEX RENDERING UTILITIES ---
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function renderLatexToHtml(latexStr, displayMode = false) {
        if (!latexStr) return '';
        const trimmed = String(latexStr).trim();
        if (window.katex) {
            try {
                let cleaned = trimmed;
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
                return window.katex.renderToString(cleaned, {
                    displayMode: displayMode,
                    throwOnError: false,
                    output: 'htmlAndMathml'
                });
            } catch (err) {
                console.warn('KaTeX render error:', err);
            }
        }
        return `<code>${escapeHtml(trimmed)}</code>`;
    }

    function formatMathText(text) {
        if (!text) return '';
        let str = String(text);
        
        // 1. Process block math: $$...$$ or \[...\]
        str = str.replace(/(\$\$|\\\[)([\s\S]*?)(\$\$|\\\])/g, (match, open, math) => {
            return `<div class="katex-display">${renderLatexToHtml(math, true)}</div>`;
        });
        
        // 2. Process inline math: $...$ or \(...\)
        str = str.replace(/(\$|\\\()([^\$\n\r]+?)(\$|\\\))/g, (match, open, math) => {
            return renderLatexToHtml(math, false);
        });

        // 3. Process raw formulas if text has LaTeX markers
        if (/(\\frac|\\boxed|\\sqrt|\\times|\\pm|\\leq|\\geq|\\neq|\\Rightarrow|\^|\_)/.test(str) && !/<span class="katex"/.test(str)) {
            const rendered = renderLatexToHtml(str, false);
            if (!rendered.startsWith('<code>')) {
                return rendered;
            }
        }

        return str;
    }

    // Modal Lightbox Controller
    const lightboxModal = document.getElementById('image-lightbox-modal');
    const lightboxFullImg = document.getElementById('lightbox-full-img');
    const btnCloseLightbox = document.getElementById('btn-close-lightbox');

    window.openLightbox = function() {
        if (selectedFileUrl && lightboxModal && lightboxFullImg) {
            lightboxFullImg.src = selectedFileUrl;
            lightboxModal.classList.remove('hidden');
        }
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

    function renderResult(data) {
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
                let resultText = q.result || (q.status === 'correct' ? 'Đúng' : 'Sai');
                const lowerRes = (resultText || '').toLowerCase();
                if (lowerRes.includes('sai') || q.status === 'incorrect') {
                    badgeClass = 'danger';
                    icon = '❌';
                } else if (lowerRes.includes('thiếu') || lowerRes.includes('chưa') || q.status === 'partial') {
                    badgeClass = 'warning';
                    icon = '⚠';
                }

                // Header HTML
                let qHtml = `
                    <div class="question-item">
                        <div class="question-header">
                            <span>Câu ${qId}</span>
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <span class="q-score">${qScore}/${qMax}</span>
                                <span class="q-badge ${badgeClass}">${icon} ${resultText}</span>
                            </div>
                        </div>
                `;

                // If problem statement exists
                if (q.problemStatementLatex) {
                    qHtml += `
                        <div style="margin-bottom: 15px; padding: 10px 14px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
                            <span style="font-weight: 600; font-size: 13px; color: var(--text-secondary);">Đề bài:</span>
                            <div class="math-display-card" style="margin-top: 4px;">${formatMathText(q.problemStatementLatex)}</div>
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
                            <div class="layer-section layer-reference">
                                <div class="layer-title-header">
                                    <div>
                                        <h4 class="layer-title">📘 ĐÁP ÁN CHUẨN</h4>
                                        <div class="layer-desc-subtitle">Lời giải Toán mẫu do AI tự giải độc lập từ đầu</div>
                                    </div>
                                </div>
                                <div class="ref-steps-list">
                        `;

                        if (q.referenceSolution.steps && q.referenceSolution.steps.length > 0) {
                            q.referenceSolution.steps.forEach(refStep => {
                                qHtml += `
                                    <div class="ref-step-item">
                                        <div class="ref-step-header">
                                            <span class="ref-step-num">${refStep.stepNumber}</span>
                                            <span>Bước ${refStep.stepNumber}: ${escapeHtml(refStep.explanation || '')}</span>
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
                                    <span class="ref-final-label">🏁 Kết luận / Đáp số:</span>
                                    <div style="font-size: 16px;">${renderLatexToHtml(q.referenceSolution.finalAnswerLatex, false)}</div>
                                </div>
                            `;
                        }

                        qHtml += `</div></div>`; // Close layer-reference
                    }

                    // ============================================
                    // LỚP 2: BÀI LÀM CỦA HỌC SINH (ẢNH GỐC)
                    // ============================================
                    if (selectedFileUrl) {
                        qHtml += `
                            <div class="layer-section layer-student-work" id="student-work-card-${idx}">
                                <div class="layer-title-header">
                                    <div>
                                        <h4 class="layer-title">📝 BÀI LÀM CỦA HỌC SINH</h4>
                                        <div class="layer-desc-subtitle">Ảnh bài làm gốc học sinh đã tải lên</div>
                                    </div>
                                    <button class="btn btn-outline" onclick="window.openLightbox()" style="padding: 4px 10px; font-size: 12px;">🔍 Phóng to ảnh</button>
                                </div>
                                <div class="student-img-preview-card">
                                    <div class="student-img-thumb-wrapper" onclick="window.openLightbox()" title="Nhấn để phóng to toàn màn hình">
                                        <img src="${selectedFileUrl}" alt="Ảnh bài làm gốc">
                                        <span class="thumb-overlay-hint">🔍 Nhấn để xem toàn cảnh</span>
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
                                        <div class="layer-desc-subtitle">Đối chiếu từng bước giải của học sinh với đáp án chuẩn</div>
                                    </div>
                                </div>
                                <div class="analysis-steps-list">
                        `;

                        q.analysis.forEach(step => {
                            const isFirstErr = !!step.isFirstError;
                            const isCascading = step.status === 'cascading_error';
                            const isIncorrect = step.status === 'incorrect';
                            const isCorrect = step.status === 'correct';

                            let cardClass = 'analysis-step-item';
                            if (isFirstErr) cardClass += ' is-first-error';
                            else if (isCascading) cardClass += ' is-cascading';

                            // Badges for step
                            let badgeTag = '';
                            if (isCorrect) {
                                badgeTag = `<span class="step-badge correct">✅ Đúng</span>`;
                            } else if (isCascading) {
                                badgeTag = `<span class="step-badge cascading">⚠ Sai do kéo theo</span>`;
                            } else if (isIncorrect) {
                                badgeTag = `<span class="step-badge incorrect">❌ Sai</span>`;
                            }

                            if (isFirstErr) {
                                badgeTag += `<span class="step-badge first-error-tag">🔴 Lỗi đầu tiên: Bước ${step.stepNumber}</span>`;
                            }

                            // Comparison Grid
                            qHtml += `
                                <div class="${cardClass}">
                                    <div class="step-card-header">
                                        <span class="step-card-title">Bước ${step.stepNumber}</span>
                                        <div class="step-badges">${badgeTag}</div>
                                    </div>
                                    
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
                            if (selectedFileUrl && step.bbox && step.bbox.width > 0 && step.bbox.height > 0) {
                                const bx = Math.max(0, Math.min(100, step.bbox.x));
                                const by = Math.max(0, Math.min(100, step.bbox.y));
                                const bw = Math.max(5, Math.min(100, step.bbox.width));
                                const bh = Math.max(5, Math.min(100, step.bbox.height));
                                
                                const topPct = -((by / bh) * 100);
                                const leftPct = -((bx / bw) * 100);
                                const widthPct = (100 / bw) * 100;
                                const heightPct = (100 / bh) * 100;

                                qHtml += `
                                    <div class="crop-preview-box" onclick="window.openLightbox()" title="Vùng cắt nét chữ trên bài làm gốc (Nhấn để xem ảnh đầy đủ)">
                                        <img class="crop-preview-img" src="${selectedFileUrl}" style="top: ${topPct}%; left: ${leftPct}%; width: ${widthPct}%; height: ${heightPct}%;" alt="Vùng chữ bước ${step.stepNumber}">
                                    </div>
                                `;
                            } else {
                                qHtml += `
                                    <div class="crop-fallback-box">
                                        <span>📷 Nét chữ bước này trên ảnh gốc</span>
                                    </div>
                                `;
                            }

                            // Student written LaTeX formula
                            const writtenClass = isCorrect ? 'student-written' : 'student-written has-error';
                            qHtml += `
                                            <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-top: 2px;">Học sinh viết:</div>
                                            <div class="math-display-card ${writtenClass}">
                                                ${renderLatexToHtml(step.studentLatex, true)}
                                            </div>
                                        </div>
                                    </div>
                            `;

                            // Remarks
                            if (step.comment) {
                                qHtml += `
                                    <div class="step-comment-box">
                                        <strong>Nhận xét:</strong> ${formatMathText(step.comment)}
                                    </div>
                                `;
                            }

                            // Correction if present
                            if (step.correctionLatex) {
                                qHtml += `
                                    <div class="step-correction-box">
                                        <strong>💡 Cách sửa:</strong> ${renderLatexToHtml(step.correctionLatex, false)}
                                    </div>
                                `;
                            }

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
                overallFeedbackList.innerHTML += `<li><span class="icon">✓</span> <div>${formatMathText(item)}</div></li>`;
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
    }

    btnGrade.addEventListener('click', async () => {
        if (!fileInput.files.length) return;
        const file = fileInput.files[0];

        btnGrade.classList.remove('pulse-glow');
        modal.classList.remove('hidden');
        modalFinalMsg.classList.add('hidden');

        // Khởi động mảng Text Loading
        const loadingSteps = [
            "Đang tải ảnh...",
            "AI đang đọc bài...",
            "AI đang phân tích...",
            "AI đang chấm..."
        ];
        let stepIdx = 0;
        loadingText.innerText = loadingSteps[stepIdx];

        const stepInterval = setInterval(() => {
            stepIdx++;
            if(stepIdx < loadingSteps.length) {
                loadingText.innerText = loadingSteps[stepIdx];
            } else {
                // Giữ ở bước cuối cùng "AI đang chấm..." cho đến khi có phản hồi
                clearInterval(stepInterval);
            }
        }, 1200);

        try {
            const formData = new FormData();
            formData.append('file', file);

            // Fetch API gọi tới Backend Gemini
            const response = await fetch('/api/v1/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            clearInterval(stepInterval);

            if (data.success) {
                loadingText.innerText = "Hoàn thành.";
                
                setTimeout(() => {
                    modal.classList.add('hidden');
                    sectionUpload.classList.add('hidden');
                    sectionResult.classList.remove('hidden');
                    renderResult(data);
                }, 800);
            } else {
                throw new Error(data.message || "Lỗi xử lý AI");
            }
        } catch (error) {
            clearInterval(stepInterval);
            loadingText.innerHTML = `<span style="color: var(--color-danger)">❌ ${error.message}</span>`;
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
});
