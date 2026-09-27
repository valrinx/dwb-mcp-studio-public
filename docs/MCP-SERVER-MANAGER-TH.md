# จัดการ MCP Servers

เปิด Dashboard แล้วเลือก **MCP Servers** เพื่อเพิ่ม server แบบ stdio, แก้ไขค่า, เปิด/ปิด, ดูสถานะ และลบออกได้ สถานะ Broker แสดงเป็นจุดกะทัดรัด; ชี้เมาส์เพื่ออ่านข้อความสถานะ การเปลี่ยนแปลงจะบันทึกไว้แม้ broker ยังไม่ทำงาน และจะมีผลเมื่อ MCP เชื่อมต่อครั้งถัดไป

## ติดตั้งจาก reference catalog

หน้า **ติดตั้งจาก Catalog** ใช้ dropdown และปุ่ม **ติดตั้ง server** สำหรับ official reference servers ของ Model Context Protocol 4 รายการ: **Everything**, **Filesystem**, **Memory** และ **Sequential Thinking** โดยใช้ package/version แบบ pin ที่ตรวจสอบ identity ก่อนบันทึก; **Filesystem** ต้องเลือกโฟลเดอร์ที่อนุญาตก่อน ระบบจะติดตั้งลงในโฟลเดอร์เฉพาะของ N3zuui และเริ่มต้นเป็นสถานะปิดใช้งาน ผู้ใช้ต้องเลือก server เปิด **Enabled** แล้วกด **Save** เองก่อน MCP จะเริ่มเรียกใช้

ปุ่ม official ชุดนี้ใช้ reference servers แบบ Node.js ที่ติดตั้งผ่าน npm ได้โดยตรง ส่วน official reference servers ที่เป็น Python (`Fetch`, `Git`, `Time`) ยังไม่แสดงเป็น Quick Install จนกว่าจะมี runtime/installer สำหรับ `uvx` และการตรวจสอบ package แยกต่างหาก

Filesystem server ให้ tools สำหรับอ่าน เขียน สร้าง ย้าย และลบไฟล์ภายใต้โฟลเดอร์ที่ระบุ อย่างไรก็ตาม การเลือกโฟลเดอร์เป็นข้อจำกัดของตัว server ไม่ใช่ Windows security sandbox: MCP package ทำงานด้วยสิทธิ์บัญชี Windows ปัจจุบัน จึงควรติดตั้งเฉพาะ package ที่เชื่อถือได้ และพิจารณาผลของ tools ก่อนเปิดใช้งาน

การติดตั้ง catalog ใช้ package version แบบ pin และสั่ง npm ปิด lifecycle scripts ระบบไม่อัปเดต package ให้อัตโนมัติ การลบรายการ catalog จะถอด server ออกจาก manager ก่อน แล้วตรวจ package identity และ path ที่ N3zuui เป็นเจ้าของก่อนลบไฟล์ติดตั้ง

## App Integrations ของแต่ละแอป

ส่วน **App Integrations** แยกจาก **Official MCP Reference Servers** โดยเฉพาะ รายการเริ่มต้นประกอบด้วย **Figma, GitHub, Linear, Atlassian, Supabase, Vercel, Cloudflare, Canva** และ **CapCut** ใช้ช่องเลือกแอปเพื่อดูประเภทการเชื่อมต่อ, ความสามารถ, endpoint และคำเตือนด้านสิทธิ์ได้

รายการ `OFFICIAL REMOTE` ไม่ใช่ npm package ที่ดาวน์โหลดลงเครื่อง แต่เป็น endpoint ของผู้ให้บริการซึ่งต้องยืนยัน OAuth/API หรือทำ client setup ตามคู่มือของแอป ปุ่ม **Quick Install** จะเพิ่ม remote MCP เข้าในรายการ N3zuui แบบปิดใช้งานก่อน จากนั้นผู้ใช้ตรวจ endpoint/สิทธิ์ แล้วเปิด **Enabled** และกด **Save** เอง ปุ่ม **คัดลอก endpoint** และ **เปิดคู่มือ** ใช้สำหรับตั้งค่า/ตรวจสอบเพิ่มเติม

`CapCut` ในรายการนี้ติดป้าย `COMMUNITY LOCAL` และ `Local · uv` เพราะเป็น bridge จากชุมชน ไม่ใช่ integration ที่ยืนยันจาก ByteDance ปุ่ม **Quick Install** จะเพิ่ม local launcher `uv run --from git+...` ให้ในรายการแบบปิดใช้งานก่อน โดย `uv` จะดึง dependency เมื่อเริ่ม server ครั้งแรก จึงต้องมี `uv`, Python และ CapCut Desktop พร้อม และควรตรวจ source ก่อนเปิดใช้งานเสมอ ([repository](https://github.com/bchenner/capcut-mcp))

## ติดตั้งจาก GitHub

วาง URL ของ public GitHub repository ในช่อง **GitHub repository** แล้วกด **ติดตั้งจาก GitHub** ตัวอย่าง `https://github.com/valrinx/raven-roblox-mcp` หรือระบุ branch/tag ด้วย `/tree/<ชื่อ>` หรือ `#<ชื่อ>` ระบบจะ clone repo, ติดตั้ง dependencies และเลือก executable จาก `package.json` ให้โดยอัตโนมัติ จากนั้นจะแสดง server ในรายการโดยปิดใช้งานไว้ก่อน แถบสถานะในกรอบ GitHub แสดงความคืบหน้าและผลลัพธ์ทันที; หากติดตั้งไม่สำเร็จจะแจ้งสาเหตุในหน้าต่างเตือน

รอบนี้รองรับ repository ของ Node.js ที่มี `package.json`, ระบุสัญญาณว่าเป็น MCP และประกาศ executable (`bin`) ที่เลือกได้ชัดเจนเท่านั้น หากเป็น Python, Docker, monorepo ที่ไม่มี executable ที่ root หรือมีหลาย executable ที่ระบุไม่ได้ ระบบจะไม่เดาคำสั่งให้ และยังเพิ่มเองได้ผ่าน **เพิ่ม server เอง**

ก่อนเริ่มติดตั้งจะแสดงหน้าต่างยืนยัน เพราะ `npm install` อาจรันสคริปต์ของ repository ด้วยสิทธิ์บัญชี Windows ของคุณ ติดตั้งเฉพาะ source ที่เชื่อถือได้ ไฟล์จะเก็บใต้ `%LOCALAPPDATA%\DWB-MCP-Studio\mcp-servers\installations\github`; การลบ server ที่ติดตั้งจาก GitHub จะตรวจ ownership metadata ก่อนนำโฟลเดอร์ติดตั้งนั้นออก

## เพิ่ม server ที่ติดตั้งไว้แล้ว

กด **New** แล้วกรอก ID, ชื่อ, executable, working directory, arguments (หนึ่งรายการต่อบรรทัด) และ environment (`KEY=VALUE`) การเรียกใช้ส่ง executable กับ arguments โดยตรง ไม่ประกอบเป็น shell command ค่า environment ที่บันทึกจะถูกป้องกันด้วย Windows DPAPI ของบัญชีปัจจุบัน

Server แต่ละตัวทำงานแยกตาม MCP session และเริ่มแบบ lazy เมื่อ client ขอรายการ tools ชื่อ tools จะเติม server ID เช่น `filesystem__read_file` เพื่อไม่ให้ชื่อจาก server หลายตัวชนกัน หาก server ใดเริ่มไม่ได้ N3zuui จะแสดง error ของ server นั้นแยกไว้ และยังคงให้ tools หลักของ broker ใช้งานได้

บาง host แคชรายการ tools ไว้และไม่โหลดรายการ dynamic ที่เพิ่มภายหลัง N3zuui จึงมี `dwb_external_mcp_list_tools` สำหรับค้นหา/อ่าน schema ของ tools จาก server ที่เปิดใช้งาน และ `dwb_external_mcp_call_tool` สำหรับเรียกด้วยชื่อเต็ม เช่น `raven-roblox-mcp-659458b3__status` วิธีนี้ยังใช้ได้เมื่อ host ไม่แสดง tools ภายนอกแยกเป็นรายการของตัวเอง; tool ภายนอกอาจเปลี่ยนข้อมูลหรือสถานะของแอปได้ จึงควรตรวจ schema และเรียกเฉพาะการกระทำที่ผู้ใช้ร้องขอ

ไฟล์ตั้งค่าอยู่ที่ `%LOCALAPPDATA%\DWB-MCP-Studio\mcp-servers.json`; การติดตั้ง catalog และ GitHub อยู่ใต้ `mcp-servers\installations` ใน data directory เดียวกัน
