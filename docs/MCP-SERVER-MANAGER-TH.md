# จัดการ MCP Servers

เปิด Dashboard แล้วเลือก **MCP Servers** เพื่อเพิ่ม server แบบ stdio, แก้ไขค่า, เปิด/ปิด, ดูสถานะ และลบออกได้ การเปลี่ยนแปลงจะบันทึกไว้แม้ broker ยังไม่ทำงาน และจะมีผลเมื่อ MCP เชื่อมต่อครั้งถัดไป

## ติดตั้งจาก catalog

รุ่นแรกมี catalog ที่คัดไว้หนึ่งรายการ: **Filesystem** จาก `@modelcontextprotocol/server-filesystem@2026.8.31` เลือกโฟลเดอร์ที่ต้องการให้ server ใช้ แล้วกด **Install** ระบบจะติดตั้งลงในโฟลเดอร์เฉพาะของ DWB ตรวจชื่อแพ็กเกจ รุ่น และ entry point ก่อนบันทึก และเริ่มต้นเป็นสถานะปิดใช้งาน ผู้ใช้ต้องเลือก server เปิด **Enabled** แล้วกด **Save** เองก่อน MCP จะเริ่มเรียกใช้

Filesystem server ให้ tools สำหรับอ่าน เขียน สร้าง ย้าย และลบไฟล์ภายใต้โฟลเดอร์ที่ระบุ อย่างไรก็ตาม การเลือกโฟลเดอร์เป็นข้อจำกัดของตัว server ไม่ใช่ Windows security sandbox: MCP package ทำงานด้วยสิทธิ์บัญชี Windows ปัจจุบัน จึงควรติดตั้งเฉพาะ package ที่เชื่อถือได้ และพิจารณาผลของ tools ก่อนเปิดใช้งาน

การติดตั้ง catalog ใช้ package version แบบ pin และสั่ง npm ปิด lifecycle scripts ระบบไม่อัปเดต package ให้อัตโนมัติ การลบรายการ catalog จะถอด server ออกจาก manager ก่อน แล้วตรวจ package identity และ path ที่ DWB เป็นเจ้าของก่อนลบไฟล์ติดตั้ง

## เพิ่ม server ที่ติดตั้งไว้แล้ว

กด **New** แล้วกรอก ID, ชื่อ, executable, working directory, arguments (หนึ่งรายการต่อบรรทัด) และ environment (`KEY=VALUE`) การเรียกใช้ส่ง executable กับ arguments โดยตรง ไม่ประกอบเป็น shell command ค่า environment ที่บันทึกจะถูกป้องกันด้วย Windows DPAPI ของบัญชีปัจจุบัน

Server แต่ละตัวทำงานแยกตาม MCP session และเริ่มแบบ lazy เมื่อ client ขอรายการ tools ชื่อ tools จะเติม server ID เช่น `filesystem__read_file` เพื่อไม่ให้ชื่อจาก server หลายตัวชนกัน หาก server ใดเริ่มไม่ได้ DWB จะแสดง error ของ server นั้นแยกไว้ และยังคงให้ tools หลักของ broker ใช้งานได้

ไฟล์ตั้งค่าอยู่ที่ `%LOCALAPPDATA%\DWB-MCP-Studio\mcp-servers.json`; การติดตั้ง catalog อยู่ใต้ `mcp-servers\installations` ใน data directory เดียวกัน
