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

    function renderResult(data) {
        // 1. Render Score
        triggerScoreAnimation(data.score);
        
        // 2. Render Summary
        resultSummary.innerText = data.summary;

        // 3. Render Questions List
        questionsList.innerHTML = '';
        if(data.questions && data.questions.length > 0) {
            data.questions.forEach(q => {
                let badgeClass = 'success';
                let icon = '✅';
                if(q.result.toLowerCase() === 'sai') { badgeClass = 'danger'; icon = '⚠'; }
                else if(q.result.toLowerCase() === 'thiếu' || q.result.toLowerCase() === 'chưa hoàn thiện') { badgeClass = 'warning'; icon = '⚠'; }

                const qHtml = `
                    <div class="question-item">
                        <div class="question-header">
                            <span>Câu ${q.question}</span>
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <span class="q-score">${q.score}/${q.max_score}</span>
                                <span class="q-badge ${badgeClass}">${icon} ${q.result}</span>
                            </div>
                        </div>
                        <div class="q-feedback">
                            <strong>Nhận xét:</strong> ${q.feedback}
                        </div>
                    </div>
                `;
                questionsList.innerHTML += qHtml;
            });
        } else {
            questionsList.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Không phát hiện được câu hỏi cụ thể.</p>';
        }

        // 4. Render Overall Feedback
        overallFeedbackList.innerHTML = '';
        if(data.overall_feedback && data.overall_feedback.length > 0) {
            data.overall_feedback.forEach(item => {
                overallFeedbackList.innerHTML += `<li><span class="icon">✓</span> ${item}</li>`;
            });
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
