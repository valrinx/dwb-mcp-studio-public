# ตรวจรับบนเครื่องใหม่ก่อนออก Stable

beta.7 ผ่านการติดตั้งและทดสอบในโฟลเดอร์/ข้อมูลใหม่บนเครื่องพัฒนาแล้ว รายการนี้ใช้ตรวจส่วนที่ยังไม่ได้ยืนยัน: Windows ที่ไม่มีสภาพแวดล้อมของผู้พัฒนา และบัญชี/client/tunnel ที่จะใช้งานจริง

## Windows เครื่องใหม่หรือ VM ที่แยกไว้

1. ใช้บัญชีผู้ใช้ทั่วไปและโฟลเดอร์ทดสอบที่ไม่มีไฟล์งานสำคัญ
2. ติดตั้ง Node.js 22.16 ขึ้นไปพร้อม npm จาก nodejs.org
3. แตก ZIP ตรวจ SHA-256 ให้ตรงไฟล์ `.sha256` แล้วเปิด `N3zuui Studio.exe`
4. เลือกโฟลเดอร์ทดสอบ กดติดตั้ง ตรวจว่า Desktop Commander และ tunnel-client อยู่ใน `external` ของ N3zuui นี้ มีรุ่นที่รองรับและ Setup สำเร็จ เปิดคู่มือจากปุ่ม **วิธีใช้ Workspace** ได้
5. นำ `mcp-client.json` ที่สร้างไปใช้ใน MCP client ทดสอบ ให้ AI แสดงรายการ tools และสถานะ broker
6. แชท A ระบุโฟลเดอร์ย่อย A พร้อมชื่อ/alias แชท B ระบุโฟลเดอร์ย่อย B ตรวจ `workingDirectory` และ worker PID ว่าตรงโฟลเดอร์และแยกกัน แล้วทดลองเขียนไฟล์เล็ก ๆ ในแต่ละที่
7. เปิดแชท C เลือกชื่อ/alias ของ A ตรวจว่าใช้โฟลเดอร์ A โดยไม่ต้องพิมพ์ path ซ้ำ และมี session แยกจากแชท A
8. ตรวจว่าการเขียนไฟล์นอก workspace ผ่าน file tool ถูกบล็อก และการเปลี่ยน workspace ไม่ตัด process ที่กำลังทำงาน

## Client/tunnel ที่ใช้แจกจริง

สำหรับ beta.8 หลัง Setup ให้กรอก Tunnel ID และ API key แล้วกด Start MCP ตรวจว่าหน้าแสดงสถานะตามจริง เปิดแชทเรียก `dwb_broker_status` เพื่อยืนยันครบเส้นทาง ปิดและเปิด `N3zuui Studio.exe` ใหม่ต้องยังพบ process เดิม; Stop ต้องหยุดเฉพาะ tunnel ของ N3zuui และ Start ซ้ำต้องใช้ key ที่จำไว้ได้ ทดสอบ key ผิดหรือขาดสิทธิ์ด้วยว่ามีสถานะให้แก้ไขโดยไม่เผย key

- ตั้งค่าเป็นโปรไฟล์ทดสอบแยกตามคู่มือของเจ้าของ connector ใช้เฉพาะโฟลเดอร์ทดสอบ
- ตรวจการล็อกอิน/credential และ discovery บนบัญชีที่มีสิทธิ์ใช้งานจริง
- ทำข้อ 6–8 ซ้ำผ่าน connector นั้น ตรวจ `contextSource` ว่ามีตัวระบุแชทที่คงที่ หาก connector ไม่ส่งข้อมูลแยกแชท จะรับรองการแยก worker ต่อแชทไม่ได้
- สำหรับ tunnel-client บน Windows คำสั่ง stdio ที่เป็นข้อความควรใส่เครื่องหมายคำพูดรอบ path และใช้ `/` เช่น `"C:/Program Files/nodejs/node.exe" "D:/N3zuui/scripts/start.mjs"` เพื่อไม่ให้ตัวแยกคำสั่งกลืน backslash
- ทดสอบปิด/เปิด connector และกลับเข้าแชทเดิม จากนั้นทดสอบ resume ไปยัง session ที่ detach แล้ว พร้อมเรียกสถานะซ้ำและทำงานต่อ

บันทึกเวอร์ชัน Windows, Node, Desktop Commander, N3zuui, client/tunnel และผลแต่ละข้อ โดยไม่รวม credential หรือไฟล์งานจริง ผล `local dev proxy` ที่ผ่านแล้วไม่ได้แทนการทดสอบบัญชีและ control plane ที่โฮสต์ภายนอก

## เครื่องมือช่วยตรวจจาก release

ในโฟลเดอร์โปรแกรมมี `scripts/acceptance-test.mjs` และ `scripts/tunnel-acceptance.mjs` สำหรับทดสอบซ้ำ ใช้กับ `DWB_DATA_DIR` และ `DWB_CONFIG_FILE` ที่ตั้งแยกไว้สำหรับการทดสอบเท่านั้น ตัวทดสอบสร้างไฟล์ใน workspace และหยุด broker ของชุดทดสอบเมื่อจบ

```powershell
node scripts/acceptance-test.mjs
# ทดสอบ tunnel ในเครื่อง โดยใช้ binary ที่ติดตั้งแยกอยู่แล้ว:
node scripts/tunnel-acceptance.mjs --tunnel-client "D:/Tools/tunnel-client.exe"
```

ตัวทดสอบ tunnel เปิดเฉพาะ loopback และไม่ใช้โปรไฟล์/บัญชี tunnel ที่มีอยู่ ไม่แถม binary ของ tunnel มาด้วย
