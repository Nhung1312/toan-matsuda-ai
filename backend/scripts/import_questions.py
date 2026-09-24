import csv
import os
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timezone

# 1. Cấu hình kết nối Firebase (Dùng Admin SDK để có quyền ghi dữ liệu)
# Lưu ý: Cần có file serviceAccountKey.json cùng thư mục với script này
cred = credentials.Certificate('serviceAccountKey.json')
firebase_admin.initialize_app(cred)

db = firestore.client()

def import_csv_to_firestore(csv_file_path):
    print(f"Đang đọc file: {csv_file_path}")
    
    with open(csv_file_path, mode='r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        
        batch = db.batch()
        count = 0
        
        for row in reader:
            doc_id = row['ID'].strip()
            if not doc_id:
                continue
                
            doc_ref = db.collection('questions').document(doc_id)
            
            # Làm sạch dữ liệu, tự động loại bỏ các đáp án rỗng (cho câu tự luận)
            data = {
                'id': doc_id,
                'lop': int(row['Lớp'].strip()),
                'chuong': row['Chương'].strip(),
                'baiHoc': row['Bài học'].strip(),
                'dangToan': row['Dạng toán'].strip(),
                'mucDo': row['Mức độ'].strip(),
                'loaiCau': row['Loại câu'].strip(),
                'cauHoi': row['Câu hỏi'].strip(),
                'dapAnDung': row['Đáp án đúng'].strip(),
                'loiGiai': row['Lời giải'].strip(),
                'nguon': row['Nguồn'].strip(),
                'createdAt': firestore.SERVER_TIMESTAMP,
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
            
            # Chỉ thêm trường đáp án nếu nó có nội dung
            for opt in ['A', 'B', 'C', 'D']:
                key = f'Đáp án {opt}'
                if row.get(key) and row[key].strip() != "":
                    data[f'dapAn{opt}'] = row[key].strip()

            batch.set(doc_ref, data)
            count += 1
            
            # Firestore giới hạn 500 thao tác cho mỗi batch
            if count % 500 == 0:
                batch.commit()
                print(f"Đã import {count} câu hỏi...")
                batch = db.batch()
                
        # Commit những câu hỏi còn sót lại
        if count % 500 != 0:
            batch.commit()
            
        print(f"✅ Hoàn tất! Đã import thành công {count} câu hỏi vào collection 'questions'.")

if __name__ == '__main__':
    # Đường dẫn tới file CSV mẫu
    csv_path = 'questions_template.csv' 
    if os.path.exists(csv_path):
        import_csv_to_firestore(csv_path)
    else:
        print(f"❌ Không tìm thấy file {csv_path}. Vui lòng kiểm tra lại.")