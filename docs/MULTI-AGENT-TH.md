# ทำงานหลาย Agent ใน Workspace เดียว

DWB รองรับการให้ MCP session หลายตัวทำงานใน workspace เดียวกัน โดยมี task board กลางใน SQLite สำหรับแบ่งงานและจองขอบเขตไฟล์

## วิธีใช้

1. ให้ทุก agent เรียก `workspace` ด้วย `action=bind` และ workspace เดียวกัน
2. ให้แต่ละ agent ลงทะเบียนตัวเอง:

```json
{
  "action": "register",
  "name": "backend-agent",
  "role": "backend"
}
```

3. สร้าง task พร้อมขอบเขตไฟล์แบบ relative path หรือ glob:

```json
{
  "action": "create",
  "title": "ทำ API",
  "description": "สร้าง endpoint สำหรับผู้ใช้",
  "file_scopes": ["src/api/**"]
}
```

4. ให้ agent claim task ด้วย `task_id` จากผลลัพธ์การสร้าง task
5. เมื่อทำเสร็จให้เรียก `complete`; หากต้องคืนงานให้เรียก `release`

## กติกาความปลอดภัย

- task ที่ active และมี scope ทับกันจะ claim พร้อมกันไม่ได้
- task ที่ไม่ระบุ `file_scopes` ถือว่าจองทั้ง workspace จึงชนกับทุก task อื่น
- agent ที่มี task active จะเขียนไฟล์นอก scope ไม่ได้ และ broker จะตอบ `DWB_TASK_SCOPE`
- task ที่มี `depends_on` จะ claim ได้เมื่อ dependency อยู่ในสถานะ `done`
- file lock และ stale-write protection เดิมของ DWB ยังทำงานร่วมกันตามปกติ

## เครื่องมือที่เพิ่ม

- `dwb_agent`: `register`, `status`, `list`
- `dwb_task`: `create`, `list`, `claim`, `complete`, `release`

ข้อมูล agent และ task เก็บในฐานข้อมูล workspace เดิมของ DWB จึงอยู่ร่วมกับ workspace binding และยังคงอยู่เมื่อ broker restart
