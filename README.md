# Đếm mắt trang sức

Web app đếm vật nhỏ (1–5 mm, 100–200 vật/lần) bằng camera điện thoại. Giao diện chạy trên **GitHub Pages**, nên camera trực tiếp hoạt động cả trên iPhone. **Google Apps Script** chỉ làm API ghi kết quả vào Google Sheet và lưu ảnh vào Drive. Toàn bộ xử lý ảnh chạy ngay trên điện thoại.

```
index.html            giao diện
counter.js            thuật toán đếm (JavaScript thuần)
worker.js             chạy thuật toán ở luồng nền
config.js             URL Apps Script mặc định (tuỳ chọn)
sw.js, manifest…      cho phép cài lên màn hình chính, mở được khi mạng yếu
gas/Code.gs           API dán vào Apps Script (không cần đưa lên Pages)
```

## Bước 1 — Apps Script (API ghi Sheet)

1. Tạo Google Sheet mới → **Tiện ích mở rộng → Apps Script**. Dán nội dung `gas/Code.gs` vào `Code.gs`, xoá các file HTML cũ nếu có.
2. Chọn hàm **`setup`** → **Chạy** → cấp quyền. Mở **Nhật ký thực thi** và ghi lại **MÃ TRUY CẬP**.
3. **Triển khai → Triển khai mới → Ứng dụng web**:
   - Thực thi dưới dạng: **Tôi**
   - Ai có quyền truy cập: **Bất kỳ ai**. Bắt buộc chọn mục này để trang GitHub gọi được; mã truy cập sẽ chặn người lạ.
4. Sao chép **URL ứng dụng web** (kết thúc bằng `/exec`).

Mỗi khi sửa `Code.gs`, vào **Triển khai → Quản lý các bản triển khai → ✏️ → Phiên bản mới**. URL giữ nguyên.

## Bước 2 — GitHub Pages

1. Đưa toàn bộ file (trừ thư mục `gas` nếu muốn) lên nhánh `main` của repo.
2. **Settings → Pages → Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main**, thư mục **/(root)** → **Save**
3. Chờ khoảng 1 phút, trang sẽ chạy ở `https://<tên-github>.github.io/<tên-repo>/`.

Có thể điền URL `/exec` vào `config.js` để khỏi nhập trên từng máy. **Không** ghi mã truy cập vào repo công khai.

## Bước 3 — Cài lên điện thoại

Cách nhanh nhất là gửi cho từng người một link cài sẵn (qua Zalo hoặc mã QR):

```
https://<tên-github>.github.io/<tên-repo>/?url=<URL_exec>&key=<MÃ>&user=<Tên người đếm>
```

App tự lưu cấu hình rồi xoá các tham số khỏi thanh địa chỉ. Bạn cũng có thể nhập tay ở mục **Kết nối Google Sheet** → **Lưu & kiểm tra kết nối**.

- **iPhone:** mở link bằng **Safari** → nút Chia sẻ → **Thêm vào MH chính**. App mở toàn màn hình như ứng dụng thật.
- **Android:** Chrome → ⋮ → **Thêm vào màn hình chính** / **Cài đặt ứng dụng**.

Lần đầu mở, trình duyệt sẽ hỏi quyền camera, bấm **Cho phép**. Nếu đã lỡ từ chối trên iPhone: **AA → Cài đặt trang web → Camera → Cho phép**, rồi bấm **Thử bật lại**.

## Sử dụng

1. Đặt khay trong khung nét đứt. Bật **Đếm trực tiếp** để xem số ước tính trong lúc xếp khay.
2. Bấm **Chụp & Đếm**. Chấm **xanh** là vật đơn, chấm **cam** là cụm dính đã được tách (nên xem kỹ), chấm **đỏ ×n** là vùng quá lớn chỉ ước lượng.
3. Sửa nếu cần: chạm vào chấm để **xoá**, chạm chỗ trống để **thêm**. Dùng **Phóng to** khi chấm dày.
4. Nhập **Người đếm** (chỉ cần lần đầu) và **Loại vật**, rồi bấm **GHI VÀO SHEET**.

Mất mạng hoặc sai mã thì bản ghi được lưu tạm trên máy và tự gửi khi kết nối lại. Bấm ghi hai lần cũng không bị trùng dòng.

## Thiết lập gợi ý (mục "Thiết lập đếm", lưu theo từng loại vật)

| Tình huống | Chỉnh |
| --- | --- |
| Vật 1–1,5 mm | Độ phân giải xử lý **2400 px** |
| Trộn nhiều cỡ trong một khay | Bật **Trộn nhiều cỡ** |
| Đá trong suốt soi đèn nền | Giữ **Lấp lõi đá trong suốt** |
| Đếm thiếu vật mờ | Tăng **Độ nhạy** (+10 đến +30) |
| Bụi bị đếm | Giảm Độ nhạy, hoặc tăng **Bỏ hạt nhỏ hơn** |
| Nền tối, vật sáng | **Kiểu ảnh**: Vật sáng / nền tối |

Phần cứng đáng đầu tư nhất là **tấm đèn nền LED** đặt dưới khay nhựa mờ.

## Cập nhật app

Sửa file và đẩy lên GitHub là xong; điện thoại tự lấy bản mới khi có mạng. Nếu máy vẫn hiện bản cũ, đóng hẳn app rồi mở lại.
