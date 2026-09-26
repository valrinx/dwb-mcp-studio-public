# แผนต่อยอด DWB เป็นตัวจัดการ MCP

## สถานะ MVP ณ 2026-09-26

- เฟสแรกและส่วน catalog ของเฟสสองมี implementation แล้ว: จัดการ stdio servers จาก Dashboard, ต่อ tools แบบ namespaced ผ่าน broker และเก็บ server แยก per session
- catalog รุ่นเริ่มต้นมี Filesystem หนึ่งรายการ ใช้ package/version แบบ pin, ติดตั้งผ่าน staging โดยปิด npm lifecycle scripts, ตรวจ identity ก่อนบันทึก และเริ่มแบบ disabled
- environment ถูกป้องกันด้วย Windows DPAPI; การลบ catalog server หยุด manager ownership ก่อนตรวจ package/path ที่ DWB เป็นเจ้าของ
- การทดสอบเฉพาะรันด้วย `npm run test:external-mcp`; คู่มือการใช้งานและ trust boundary อยู่ใน [MCP Server Manager](MCP-SERVER-MANAGER-TH.md)
- ขอบเขตที่ยังเหลือ: catalog เพิ่มเติม, ปุ่ม restart/ราย-tool allowlist และ remote Streamable HTTP/SSE ตามเฟสถัดไป

## เป้าหมาย

ให้ DWB จัดการ MCP Server หลายตัวจากแอปเดียว แล้วเปิดเครื่องมือของแต่ละ Server ผ่าน MCP connection ของ DWB ที่มีอยู่ โดยไม่ทำให้ Desktop Commander, workspace binding, multi-agent และ tunnel เดิมเสียความเข้ากันได้

จาก RVN ที่ติดตั้งอยู่ในเครื่อง รูปแบบที่ยืนยันได้คือเพิ่ม server ด้วย `Name`, `Command`, `Working directory`, `Type`, `Args` และ `Environment` และตั้งค่า allowlist ส่วนหน้าจอที่ตรวจดูไม่มี catalog สำหรับติดตั้งแพ็กเกจแบบคลิกเดียว ดังนั้นแผนนี้แยกการจัดการ command ที่มีอยู่แล้ว ออกจากการติดตั้งผ่าน catalog

## ขอบเขตผลิตภัณฑ์

1. จัดการ MCP Server ภายนอก: เพิ่ม แก้ไข เปิด/ปิด ตรวจสถานะ เริ่มใหม่ และลบรายการ
2. รวม tools ของ Server ที่เปิดใช้งานไว้ใน DWB MCP endpoint เดียว โดยเติม prefix จาก server ID เพื่อกันชื่อชนกันและคงเส้นทางเรียกกลับไปยัง server ต้นทาง
3. ติดตั้ง MCP Server จาก catalog ที่ DWB ดูแล โดย pin package/version และติดตั้งลงโฟลเดอร์เฉพาะของ DWB
4. รักษา Desktop Commander เป็น worker เฉพาะทางของเดิม ไม่บังคับให้ MCP ทุกตัวมี package layout แบบ Desktop Commander

ขอบเขตเริ่มต้นรองรับ local `stdio` servers ก่อน ส่วน remote Streamable HTTP/SSE เป็นเฟสถัดไปหลัง lifecycle และ routing ของ stdio เสถียร

## โครงสร้างที่เสนอ

```text
Dashboard
  ├─ Server settings / curated catalog
  └─ install, enable, stop, remove
          ↓
External MCP Registry + Installer
          ↓
External MCP Supervisor (stdio children)
          ↓
DWB Broker: list/namespace tools และ route tool calls
          ↓
MCP Client ใช้ DWB connection เดิม
```

- เพิ่ม registry/supervisor แยกจาก `WorkerSupervisor` ซึ่งมี assumptions เฉพาะ Desktop Commander
- เก็บ manifest และสถานะติดตั้งใน data directory ของผู้ใช้ ไม่ปะปนกับ source, `node_modules` ของ DWB หรือ workspace
- เรียกโปรแกรมด้วย executable และ argument array โดยตรง ไม่ประกอบเป็น shell command
- ติดตั้งแบบ staging, ตรวจชื่อและรุ่น package, แล้วค่อย activate; เมื่อล้มเหลวให้คง installation เดิม
- ตั้ง namespace ให้ tool ภายนอก เช่น `github__create_issue`; core tools `dwb_*` และชื่อ tool เดิมของ Desktop Commander คงเดิม
- เริ่มต้นให้ process เป็น per-session โดยปริยายเพื่อแยก state ระหว่างแชท; ถ้าจะรองรับ server แบบ shared ต้องระบุพฤติกรรมและขอบเขตข้อมูลชัดเจน พร้อมจำกัดจำนวน process แยกจาก `workerCap` ของ Desktop Commander

## แผนเฟส

### เฟส 1 — เชื่อม MCP Server แบบ stdio ที่ติดตั้งไว้แล้ว

- กำหนด schema สำหรับ server ID, command, args, working directory, environment, enabled state และ isolation
- เพิ่ม lifecycle: start, MCP initialize, discover tools, call routing, health/status, restart และ cleanup
- รวม tool list โดย namespace และ route ไปยัง upstream ตาม mapping ที่ broker เก็บไว้ ไม่ parse ชื่อ tool กลับแบบคลุมเครือ
- เพิ่ม config/API สำหรับ list/add/update/enable/disable/remove และแสดงข้อผิดพลาดที่แก้ได้
- เพิ่ม UI จัดการรายการแบบเดียวกับหน้าตั้งค่า MCP ใน RVN

### เฟส 2 — ติดตั้งจาก catalog

- เพิ่ม catalog แบบ version-controlled ที่ระบุ package source, package/version pin, command, args และ required environment keys
- ติดตั้งด้วย npm ลง staging เฉพาะ server; ตรวจ package identity/version ก่อน activate
- รองรับ update/rollback และลบเฉพาะ path ที่ registry ของ DWB เป็นเจ้าของ
- แสดงแหล่งที่มา รุ่น สิทธิ์ที่ต้องใช้ และ environment ที่จำเป็นก่อนติดตั้ง/เปิดใช้งาน
- ไม่ติดตั้งหรือรัน package จาก catalog โดยอัตโนมัติระหว่างเปิดแอป

### เฟส 3 — ความปลอดภัยและการเชื่อมต่อเพิ่มเติม

- เก็บ secret ด้วย Windows DPAPI; ไม่เขียน secret ลง config, log หรือ command line
- มี allowlist/disable ราย server และราย tool พร้อมคำเตือนว่าคำสั่ง MCP ภายนอกทำงานด้วยสิทธิ์ของบัญชี Windows
- กำหนดชัดว่า workspace boundary และ file locks ของ DWB ครอบคลุมเฉพาะเครื่องมือที่ DWB รู้จัก ไม่ถือว่าป้องกัน side effects ของ MCP ภายนอก
- เพิ่ม remote Streamable HTTP เมื่อมี credential storage, timeout, reconnect และ permission model ที่ผ่านการออกแบบ

## เกณฑ์รับงาน

- ผู้ใช้เพิ่ม stdio server ได้ และเห็นสถานะ/ข้อผิดพลาดจาก Dashboard
- DWB แสดง tools ของ server ที่เปิดใช้งาน โดยชื่อไม่ชนกับ server อื่นหรือ core tools
- เรียก tool แล้วถึง upstream server ที่ถูกต้อง พร้อม arguments เดิม และไม่เรียก server อื่น
- Server ที่ปิดใช้งานหรือเริ่มไม่สำเร็จไม่ทำให้ MCP connection หลักล่ม
- การติดตั้ง catalog ใช้รุ่นที่ pin ไว้ ตรวจ package ก่อนใช้งาน และ rollback ได้เมื่อการติดตั้งไม่ครบ
- config เดิมของ DWB และการ migrate beta เดิมยังทำงาน; Desktop Commander, workspace และ task coordination ผ่าน regression checks
- มีคำอธิบาย trust boundary และข้อมูลที่เก็บในเครื่องในคู่มือผู้ใช้

## จุดเชื่อมกับโค้ดปัจจุบัน

- `src/index.ts` เป็น public stdio MCP endpoint และส่ง `tools/list` / `tools/call` เข้า `BrokerClient`; ไม่ควรเพิ่ม process management ไว้ใน adapter นี้
- `src/broker-server.ts` เป็นจุดรวม tool list และ routing จริง ปัจจุบันต่อ tools ของ Desktop Commander จาก `SessionRegistry` แล้วเติม `brokerTools`; MCP ภายนอกจึงควรมี route table ของตัวเองและเพิ่มเฉพาะชื่อที่ namespace แล้ว โดยไม่ส่งชื่อ tool ที่ถูกแปลงกลับไปให้ upstream
- `src/session-registry.ts` และ `src/worker-supervisor.ts` ดูแล Desktop Commander, queue, workspace และ lifecycle ที่ผูกกับ session อยู่แล้ว ควรคงไว้เฉพาะทาง และให้ supervisor ใหม่รับผิดชอบ external MCP protocol/lifecycle แยกต่างหาก
- `src/broker-protocol.ts` / `src/broker-client.ts` ใช้ IPC แบบ newline JSON ระหว่าง adapter กับ broker ส่วน `scripts/dashboard-probe.mjs` เรียก `inspect` แบบอ่านอย่างเดียว ดังนั้นหน้า Dashboard จัดการ config ไม่ได้ในปัจจุบัน ต้องเพิ่มช่องทางคำสั่งแบบ local ที่ตรวจ input และจำกัดเฉพาะงาน MCP manager ไม่เปิด endpoint เครือข่ายใหม่
- UI อยู่ใน `scripts/dashboard.xaml` + `scripts/dashboard.ps1` (WPF); `scripts/dashboard-probe.mjs` สร้าง snapshot และอ่าน config จาก `dataDir()` ซึ่งมาจาก `src/paths.ts` (`%LOCALAPPDATA%\\DWB-MCP-Studio` บน Windows) เป็นจุดที่ควรต่อรายการ server, สถานะ และฟอร์มจัดการ
- config/server definitions และ package install ควรอยู่ใต้ data directory นี้ ไม่ปะปนกับ config ของ Desktop Commander, source tree หรือ workspace; ห้ามบันทึกค่า secret ลง JSON/log และการเรียก child process ต้องใช้ executable + argv โดยตรง

ลำดับ integration ที่แนะนำสำหรับเฟสแรก: สร้าง model/store และ stdio supervisor แยก → ต่อ `list_tools`/`call_tool` ใน broker ด้วย mapping ที่เก็บต่อ session → เพิ่ม management request แบบ local IPC พร้อม validation → เพิ่ม Dashboard form/status → ค่อยต่อ curated installer หลัง lifecycle และ routing ผ่านการทดสอบ

## TDD และจุดเริ่มตรวจพฤติกรรม

`TDD_REQUIRED: yes` สำหรับ lifecycle, namespace และ routing เพราะเป็น behavior ใหม่ที่แตะ public MCP surface

จุดทดสอบ observable แรก: สร้าง MCP test server จริงผ่าน stdio, ให้ DWB ค้นพบ tool ที่มีชื่อซ้ำกับอีก server, แสดงชื่อแบบ namespaced แล้วเรียกชื่อหนึ่งและยืนยันว่าไปถึง server/arguments ที่ตรงกัน

RED command ที่เสนอหลังเริ่ม implementation: `npm exec -- tsx src/external-mcp-manager-test.ts`

จากนั้นเพิ่ม tests สำหรับ start/stop/restart, server ปิดหรือ initialize ล้มเหลว, duplicate IDs/tool names, disabled server, limits ของ process และ install staging/rollback โดยใช้ fixture ในเครื่อง ไม่พึ่ง npm network ใน unit tests

## ลำดับเริ่มงาน

1. สร้าง contract สำหรับ `ExternalMcpDefinition`, runtime status และ namespaced tool routing
2. เขียน integration-style test ด้วย stdio fixture ให้เห็น RED
3. ทำ supervisor/registry และ broker routing ให้ผ่าน focused test
4. ต่อ Dashboard ให้จัดการ custom stdio entries
5. เพิ่ม curated package catalog และ staged installer
6. เพิ่มการปกป้อง secret, permission controls, เอกสาร และ candidate-wide verification ก่อนส่งมอบ
