# ทำงานหลาย Agent ข้ามแชทใน Workspace เดียว

DWB รองรับการให้ MCP session หลายตัวทำงานใน workspace เดียวกัน โดยมี task board กลางใน SQLite สำหรับแบ่งงานและจองขอบเขตไฟล์
Main Agent, Planner, Coder, Tester และ Reviewer สามารถอยู่คนละ ChatGPT chat แต่ bind workspace เดียวกันได้ Broker จะส่งงาน, handoff และข้อความข้าม session ให้เอง โดยไม่ต้องให้ agent เปิดแชทหรือส่งข้อความด้วยวิธีอื่น

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

`delegate` จะสร้าง task, หา worker ที่ตรง role/capability, claim งาน และส่ง `task_assigned` ให้ worker ทันที ถ้ายังไม่มี worker ที่พร้อม งานจะค้างเป็น `queued` แล้ว broker จะลอง dispatch ใหม่เมื่อ worker เชื่อมต่อหรือเมื่อมีเหตุการณ์ที่ทำให้งานพร้อม เช่น release, reopen หรือ dependency เสร็จ ไม่ต้องรอ heartbeat รอบถัดไป หากเปิด `autonomousAgents` ไว้ broker จะเปิด Local Codex worker เป็น fallback ให้ role ที่ต้องการเอง; ถ้าต้องการให้เป็นแชท Planner/Coder/Tester/Reviewer ที่เห็นใน sidebar ให้เปิดแชทนั้นไว้และ register agent ใน workspace เดียวกันก่อน
ถ้าต้องการส่งตรงไปยังแชทใด ให้เรียก `dwb_agent action=list` ดู `id` ของ agent แล้วใส่ `to_agent_id` ใน `delegate` หรือ `dispatch`:

```json
{
  "action": "delegate",
  "title": "แก้ backend",
  "description": "แก้เฉพาะส่วน API และรายงานผลกลับมา",
  "required_role": "coder",
  "to_agent_id": "agent_1234abcd"
}
```

งานจะเข้าคิวของ session ในแชทเป้าหมายและมี notification `task_assigned`; ถ้าแชทนั้นยังไม่เชื่อมต่อ ข้อความจะค้างใน inbox จนกว่าแชทจะกลับมาเชื่อมต่อ หากเปิด `autonomousAgents` broker จึงค่อยสร้าง local worker เป็นทางเลือกเมื่อไม่มี agent ที่พร้อม

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

`wait` จะคืนทันทีเมื่อมี assignment หรือ handoff ใหม่เข้ามา และคืน `timedOut: true` เมื่อครบเวลาโดยไม่มีข้อความ จากนั้น worker ควร `ack` ข้อความและทำงานต่อ หาก timeout โดยไม่มีข้อความ ให้เรียก `wait` ซ้ำทันทีตราบใดที่ยังต้องการรับงาน เพื่อให้ session ค้างอยู่และ broker ปลุก/dispatch งานให้เองโดยไม่ต้อง polling หรือรอ heartbeat 15 วินาที

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

การส่งข้อความ, notification และการปลุก `wait` เป็นอัตโนมัติที่ broker เมื่อ MCP session ยังเชื่อมอยู่ broker จะคืน agent ที่ถูกพักกลับเป็น `active` ก่อน dispatch งานค้างให้เอง และ DWB client จะ reconnect broker เบื้องหลังพร้อม session เดิมเมื่อ broker ถูก restart โดยไม่ต้องรอ tool call ใหม่ หาก host สร้าง MCP session ใหม่แต่ส่ง logical chat context เดิมกลับมา การ bind workspace จะ rebind agent เดิมให้เองด้วย จึงไม่ต้อง register ซ้ำ Agent แต่ละตัวสามารถเรียก `dwb_agent action=send` ส่งข้อความตรงข้ามแชท หรือใช้ `dwb_task action=complete` เพื่อให้ broker ส่ง handoff ไปยัง task ถัดไป หาก host ปิด session และต้องการให้มี worker ทำงานต่อโดยไม่ต้องเปิดแชทค้าง ให้เปิด autonomous mode; broker จะใช้ `codex exec --ephemeral` เป็น worker process แยกและเชื่อม DWB MCP โดยตรง

เปิด autonomous mode ใน `%LOCALAPPDATA%\DWB-MCP-Studio\config.json`:

```json
{
  "autonomousAgents": true
}
```

หรือใช้ `node scripts/configure.mjs --autonomous-agents` จากโฟลเดอร์โปรเจกต์ จากนั้น restart MCP/broker. ระบบใช้ `codex` จาก PATH หรือค่าจาก `DWB_CODEX_EXECUTABLE`; ค่า sandbox เริ่มต้นคือ `workspace-write` และใช้ `--approve-for-me` เพื่อให้ worker เรียก MCP ต่อเนื่องได้โดยไม่รอคนกดยืนยัน เปลี่ยนเป็น `read-only` หรือ `danger-full-access` ได้ด้วย `DWB_AUTONOMOUS_SANDBOX` ตามความเสี่ยงของงาน (งานที่ต้องเรียก tool ควรใช้ `workspace-write`). broker จะอ่าน `workerEntry`, `workerCap`, policy และ `autonomousAgents` จาก config เองแม้ถูกเปิดโดย client ตรง ๆ ปิดได้ด้วย `autonomousAgents: false` หรือ `DWB_AUTONOMOUS_AGENTS=false`

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
- หาก agent ไม่ heartbeat เกิน lease ระบบจะเปลี่ยน agent เป็น `paused` และคืน task ที่กำลังทำกลับเป็น `queued`; ถ้า MCP session เดิมยังเชื่อมอยู่ broker จะปลุกกลับเป็น `active` และ dispatch งานให้อัตโนมัติ
- agent ที่ lease หมดอายุจะถูกบล็อกไม่ให้เขียนจนกว่า heartbeat หรือ register ใหม่
- `changed_files` ต้องเป็น path แบบ relative ภายใน workspace และห้ามใช้ glob; broker จะปฏิเสธ path นอก workspace
- file lock และ stale-write protection เดิมของ DWB ยังทำงานร่วมกันตามปกติ

## เครื่องมือที่เพิ่ม

- `dwb_agent`: `register`, `heartbeat`, `status`, `list`, `inbox`, `ack`
- `dwb_task`: `create`, `delegate`, `list`, `claim`, `dispatch`, `complete`, `handoff`, `release`, `block`, `cancel`, `reopen`, `history`

ข้อมูล agent และ task เก็บในฐานข้อมูล workspace เดิมของ DWB จึงอยู่ร่วมกับ workspace binding และยังคงอยู่เมื่อ broker restart
