# จัดการ MCP Servers

เปิด Dashboard แล้วเลือก **MCP Servers** เพื่อเพิ่ม server แบบ stdio, แก้ไขค่า, เปิด/ปิด, ดูสถานะ และลบออกได้ การเปลี่ยนแปลงจะบันทึกไว้แม้ broker ยังไม่ทำงาน และจะมีผลเมื่อ MCP เชื่อมต่อครั้งถัดไป

## ติดตั้งจาก catalog

รุ่นแรกมี catalog ที่คัดไว้หนึ่งรายการ: **Filesystem** จาก `@modelcontextprotocol/server-filesystem@2026.8.31` เลือกโฟลเดอร์ที่ต้องการให้ server ใช้ แล้วกด **Install** ระบบจะติดตั้งลงในโฟลเดอร์เฉพาะของ DWB ตรวจชื่อแพ็กเกจ รุ่น และ entry point ก่อนบันทึก และเริ่มต้นเป็นสถานะปิดใช้งาน ผู้ใช้ต้องเลือก server เปิด **Enabled** แล้วกด **Save** เองก่อน MCP จะเริ่มเรียกใช้

Filesystem server ให้ tools สำหรับอ่าน เขียน สร้าง ย้าย และลบไฟล์ภายใต้โฟลเดอร์ที่ระบุ อย่างไรก็ตาม การเลือกโฟลเดอร์เป็นข้อจำกัดของตัว server ไม่ใช่ Windows security sandbox: MCP package ทำงานด้วยสิทธิ์บัญชี Windows ปัจจุบัน จึงควรติดตั้งเฉพาะ package ที่เชื่อถือได้ และพิจารณาผลของ tools ก่อนเปิดใช้งาน

การติดตั้ง catalog ใช้ package version แบบ pin และสั่ง npm ปิด lifecycle scripts ระบบไม่อัปเดต package ให้อัตโนมัติ การลบรายการ catalog จะถอด server ออกจาก manager ก่อน แล้วตรวจ package identity และ path ที่ DWB เป็นเจ้าของก่อนลบไฟล์ติดตั้ง

## ติดตั้งจาก GitHub

วาง URL ของ public GitHub repository ในช่อง **GitHub repository** แล้วกด **ติดตั้งจาก GitHub** ตัวอย่าง `https://github.com/valrinx/raven-roblox-mcp` หรือระบุ branch/tag ด้วย `/tree/<ชื่อ>` หรือ `#<ชื่อ>` ระบบจะ clone repo, ติดตั้ง dependencies และเลือก executable จาก `package.json` ให้โดยอัตโนมัติ จากนั้นจะแสดง server ในรายการโดยปิดใช้งานไว้ก่อน แถบสถานะในกรอบ GitHub แสดงความคืบหน้าและผลลัพธ์ทันที; หากติดตั้งไม่สำเร็จจะแจ้งสาเหตุในหน้าต่างเตือน

รอบนี้รองรับ repository ของ Node.js ที่มี `package.json`, ระบุสัญญาณว่าเป็น MCP และประกาศ executable (`bin`) ที่เลือกได้ชัดเจนเท่านั้น หากเป็น Python, Docker, monorepo ที่ไม่มี executable ที่ root หรือมีหลาย executable ที่ระบุไม่ได้ ระบบจะไม่เดาคำสั่งให้ และยังเพิ่มเองได้ผ่าน **เพิ่ม server เอง**

ก่อนเริ่มติดตั้งจะแสดงหน้าต่างยืนยัน เพราะ `npm install` อาจรันสคริปต์ของ repository ด้วยสิทธิ์บัญชี Windows ของคุณ ติดตั้งเฉพาะ source ที่เชื่อถือได้ ไฟล์จะเก็บใต้ `%LOCALAPPDATA%\DWB-MCP-Studio\mcp-servers\installations\github`; การลบ server ที่ติดตั้งจาก GitHub จะตรวจ ownership metadata ก่อนนำโฟลเดอร์ติดตั้งนั้นออก

## เพิ่ม server ที่ติดตั้งไว้แล้ว

กด **New** แล้วกรอก ID, ชื่อ, executable, working directory, arguments (หนึ่งรายการต่อบรรทัด) และ environment (`KEY=VALUE`) การเรียกใช้ส่ง executable กับ arguments โดยตรง ไม่ประกอบเป็น shell command ค่า environment ที่บันทึกจะถูกป้องกันด้วย Windows DPAPI ของบัญชีปัจจุบัน

Server แต่ละตัวทำงานแยกตาม MCP session และเริ่มแบบ lazy เมื่อ client ขอรายการ tools ชื่อ tools จะเติม server ID เช่น `filesystem__read_file` เพื่อไม่ให้ชื่อจาก server หลายตัวชนกัน หาก server ใดเริ่มไม่ได้ DWB จะแสดง error ของ server นั้นแยกไว้ และยังคงให้ tools หลักของ broker ใช้งานได้

ไฟล์ตั้งค่าอยู่ที่ `%LOCALAPPDATA%\DWB-MCP-Studio\mcp-servers.json`; การติดตั้ง catalog และ GitHub อยู่ใต้ `mcp-servers\installations` ใน data directory เดียวกัน
