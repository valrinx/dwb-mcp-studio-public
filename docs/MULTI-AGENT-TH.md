# ทำงานหลาย Agent ใน Workspace เดียว

DWB รองรับการให้ MCP session หลายตัวทำงานใน workspace เดียวกัน โดยมี task board กลางใน SQLite สำหรับแบ่งงานและจองขอบเขตไฟล์

## วิธีใช้

1. ให้ทุก agent เรียก `workspace` ด้วย `action=bind` และ workspace เดียวกัน
2. ให้ agent หลักลงทะเบียนเป็น `main` และให้ worker ลงทะเบียนตาม role:

```json
{
  "action": "register",
  "name": "main-agent",
  "role": "main"
}
```

```json
{
  "action": "register",
  "name": "backend-agent",
  "role": "backend",
  "capabilities": ["typescript", "api"]
}
```

3. เมื่อผู้ใช้สั่งงานใหญ่ ให้ main agent แยกงานและมอบหมายด้วย `delegate` ได้ในคำสั่งเดียว:

```json
{
  "action": "delegate",
  "title": "ทำ API ผู้ใช้",
  "description": "สร้าง endpoint และ validation พร้อมเทสต์",
  "file_scopes": ["src/api/**"],
  "required_role": "backend",
  "required_capabilities": ["typescript", "api"],
  "priority": 10
}
```

`delegate` จะสร้าง task, หา worker ที่ตรง role/capability, claim งาน และส่ง `task_assigned` ให้ worker ทันที ถ้ายังไม่มี worker ที่พร้อม งานจะค้างเป็น `queued` แล้ว broker จะลอง dispatch ใหม่เมื่อ worker เชื่อมต่อหรือเมื่อมีเหตุการณ์ที่ทำให้งานพร้อม เช่น release, reopen หรือ dependency เสร็จ ไม่ต้องรอ heartbeat รอบถัดไป

4. ถ้าต้องการแยกขั้นตอนเอง สามารถสร้าง task พร้อมขอบเขตไฟล์แบบ relative path หรือ glob:

```json
{
  "action": "create",
  "title": "ทำ API",
  "description": "สร้าง endpoint สำหรับผู้ใช้",
  "file_scopes": ["src/api/**"],
  "required_role": "backend",
  "required_capabilities": ["typescript", "api"],
  "priority": 10
}
```

5. งานที่ระบุ `required_role` หรือ `required_capabilities` จะถูก dispatch ให้ agent ที่ว่างโดย broker heartbeat หรือสั่งทันทีด้วย `dwb_task action=dispatch`
6. เมื่อ worker ได้ notification `task_assigned` ให้ตอบรับด้วย `dwb_agent action=ack` แล้วเริ่มทำ task ที่ได้รับ จากนั้นเมื่อทำเสร็จให้เรียก `complete` พร้อม handoff ให้ agent ถัดไป:

```json
{
  "action": "complete",
  "task_id": "task_1234abcd",
  "summary": "สร้าง API และเพิ่ม validation แล้ว",
  "changed_files": ["src/api/routes.ts", "src/api/routes.test.ts"],
  "test_result": { "command": "npm test -- api", "passed": true },
  "result": { "artifact": "api-ready" }
}
```

agent ถัดไปอ่านข้อมูลได้ด้วย `dwb_task action=handoff` หรือดูรวมใน `history`; หากต้องคืนงานให้เรียก `release`

ถ้า task ถัดไปมี `depends_on` และถูก dispatch ให้ Agent อื่น broker จะส่ง notification ให้อัตโนมัติ Agent ปลายทางดูข้อความที่ยังไม่ได้ตอบรับได้ด้วย:

```json
{
  "action": "inbox"
}
```

เมื่อตอบรับแล้ว:

```json
{
  "action": "ack",
  "message_id": "msg_1234abcd"
}
```

broker จะส่ง `handoff_ack` กลับไปยัง Agent ต้นทางด้วย ถ้า Agent ปลายทาง offline ข้อความจะค้างอยู่ใน inbox จนกว่าจะกลับมาเชื่อมต่อและตอบรับ

ถ้า host รองรับการรอ tool call ให้ worker ค้างรอข้อความถัดไปได้โดยไม่ต้อง polling:

```json
{
  "action": "wait",
  "timeout_ms": 30000
}
```

`wait` จะคืนทันทีเมื่อมี assignment หรือ handoff ใหม่เข้ามา และคืน `timedOut: true` เมื่อครบเวลาโดยไม่มีข้อความ จากนั้น worker ควร `ack` ข้อความและทำงานต่อ การรอแบบนี้เป็น event-driven จึงไม่ต้องรอ broker heartbeat 15 วินาที

ระหว่างทำงาน agent สามารถส่งข้อความตรงถึง agent อื่นได้:

```json
{
  "action": "send",
  "to_agent_id": "agent_1234abcd",
  "message": "ติด blocker ที่ validation ขอข้อมูลเพิ่มเติม"
}
```

ข้อความนี้ถูกเก็บใน inbox และตอบรับกลับได้ด้วย `ack` เช่นเดียวกับ assignment/handoff โดยใช้ `agent_message_ack`

สำหรับงานที่ main agent เป็นผู้มอบหมาย worker จะตอบรับ assignment กลับเป็น `task_assignment_ack` และเมื่อ task ก่อนหน้าจบ broker จะส่ง `task_handoff` ให้ task ถัดไปเอง ดังนั้นลำดับปกติคือ:

```text
ผู้ใช้ → main agent → delegate → worker A
                               └→ task_assignment_ack
worker A complete → worker B task_handoff → worker B complete → main agent
```

การส่งข้อความ, notification และการปลุก `wait` เป็นอัตโนมัติที่ broker แต่การให้โมเดล worker เริ่มเรียกเครื่องมือเองหลังได้รับ notification ยังต้องอาศัย MCP host ที่รองรับ server notifications หรือให้ worker เรียก `wait` ค้างไว้ หาก host รองรับเฉพาะ request/response จะต้องเรียก `inbox` หรือ `task list` เป็นรอบ ๆ

Agent ที่ยังทำงานอยู่ควรเรียก `dwb_agent` ด้วย `action=heartbeat` เป็นระยะ ระบบจะต่ออายุ lease ให้อัตโนมัติระหว่างการเรียกเครื่องมือของ agent ด้วย

## กติกาความปลอดภัย

- task ที่ active และมี scope ทับกันจะ claim พร้อมกันไม่ได้
- task ที่ไม่ระบุ `file_scopes` ถือว่าจองทั้ง workspace จึงชนกับทุก task อื่น
- agent ที่มี task active จะเขียนไฟล์นอก scope ไม่ได้ และ broker จะตอบ `DWB_TASK_SCOPE`
- task ที่มี `depends_on` จะ claim ได้เมื่อ dependency อยู่ในสถานะ `done`
- agent ต้องตรงกับ `required_role` และมี capabilities ครบจึงจะรับงานอัตโนมัติได้
- งานที่มี `priority` สูงกว่าจะถูกพิจารณาก่อนในรอบ auto-dispatch
- task ที่ติดปัญหาใช้ `block` พร้อมเหตุผลได้ และเปิดกลับเป็น `queued` ด้วย `reopen`
- task ที่ยกเลิกแล้วใช้ `cancel` และสามารถ `reopen` กลับมาทำใหม่ได้
- หาก agent ไม่ heartbeat เกิน lease ระบบจะเปลี่ยน agent เป็น `paused` และคืน task ที่กำลังทำกลับเป็น `queued`
- agent ที่ lease หมดอายุจะถูกบล็อกไม่ให้เขียนจนกว่า heartbeat หรือ register ใหม่
- `changed_files` ต้องเป็น path แบบ relative ภายใน workspace และห้ามใช้ glob; broker จะปฏิเสธ path นอก workspace
- file lock และ stale-write protection เดิมของ DWB ยังทำงานร่วมกันตามปกติ

## เครื่องมือที่เพิ่ม

- `dwb_agent`: `register`, `heartbeat`, `status`, `list`, `inbox`, `ack`
- `dwb_task`: `create`, `delegate`, `list`, `claim`, `dispatch`, `complete`, `handoff`, `release`, `block`, `cancel`, `reopen`, `history`

ข้อมูล agent และ task เก็บในฐานข้อมูล workspace เดิมของ DWB จึงอยู่ร่วมกับ workspace binding และยังคงอยู่เมื่อ broker restart
