# Đếm mắt trang sức — đếm trực tiếp

Mở web bằng điện thoại, dùng camera đếm vật nhỏ (1–5 mm) ngay trên màn hình. Toàn bộ xử lý chạy trên máy, không cần mạng sau khi mở, không ghi dữ liệu đi đâu.

Địa chỉ: `https://<tên-github>.github.io/<tên-repo>/`

## File trong repo

```
index.html            giao diện đếm trực tiếp toàn màn hình
counter.js            thuật toán đếm + phân loại
worker.js             chạy thuật toán ở luồng nền
sw.js                 cho phép mở khi mạng yếu, tự cập nhật bản mới
manifest.webmanifest  cài lên màn hình chính như app
icon-192.png, icon-512.png, apple-touch-icon.png
```

## Sử dụng

- **Nền đếm:** Tự nhận (light pad trắng với khung viền bất kỳ, hoặc tấm nền đen / đỏ / xanh lá / xanh dương).
- **Dừng:** đứng hình và đếm lại ở độ nét cao để chốt số; **Tiếp tục** để đếm trực tiếp.
- **Đếm theo chủng loại:** bật trong Cài đặt; số loại tự đoán hoặc chọn 2–6.
- iPhone: Safari → Chia sẻ → **Thêm vào MH chính** để chạy toàn màn hình.
