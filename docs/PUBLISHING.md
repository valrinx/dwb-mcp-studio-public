# เผยแพร่ผ่าน Git

ใช้โฟลเดอร์ `dwb-mcp-studio-public` เป็น repository สำหรับแจก แยกจากประวัติ Git ของโปรแกรมส่วนตัว

## เนื้อหา repository

เก็บ source ของ N3zuui, scripts, assets ของ N3zuui, docs, package.json, package-lock.json, LICENSE, LICENSE-UPSTREAM-MIT และ THIRD-PARTY.md ไว้ครบ

`.gitignore` กัน `external/`, `node_modules/`, `dist/`, `logs/`, `data/`, `runtime/`, `releases/`, `.env` และไฟล์ key ที่ระบุไว้ ผู้ใช้ clone แล้วเปิด Setup เพื่อ build และติดตั้งส่วนประกอบได้ ไม่ต้อง commit โปรแกรมที่ดาวน์โหลดแล้ว

ก่อน push ให้ดู `git status` และ `git diff --cached` ตรวจชื่อไฟล์และเนื้อหาที่จะขึ้น repository ด้วย `.gitignore` ไม่เอาไฟล์ที่เคย tracked ออกจาก Git และไม่ล้างข้อมูลในประวัติเดิม

## License และ attribution

- LICENSE ของ N3zuui เป็น Proprietary License และสงวนสิทธิ์ทั้งหมดสำหรับโค้ด/แบรนด์ที่สร้างโดย N3zuui Studio
- โค้ดที่สืบทอดจาก upstream ต้องรักษาประกาศและเงื่อนไขใน [LICENSE-UPSTREAM-MIT](../LICENSE-UPSTREAM-MIT) และ license ของส่วนประกอบอื่นตามที่ระบุใน THIRD-PARTY.md
- Desktop Commander 0.2.50 เป็น [MIT](https://raw.githubusercontent.com/wonderwhy-er/DesktopCommanderMCP/v0.2.50/LICENSE) และ tunnel-client 0.0.11 เป็น [Apache-2.0](https://raw.githubusercontent.com/openai/tunnel-client/v0.0.11/LICENSE) Setup ดาวน์โหลดจากเจ้าของโดยตรงและเก็บไฟล์ license ที่มากับแพ็กเกจไว้
- หากมีโค้ดหรือ assets ของผู้อื่นรวมอยู่ใน repository ต้องรักษาเงื่อนไขและประกาศของส่วนนั้น การใส่ LICENSE ของ N3zuui ไม่ได้เปลี่ยนสิทธิ์ของผู้อื่น
- ใช้ชื่อ N3zuui เป็นชื่อผลิตภัณฑ์ ระบุโปรแกรมที่ทำงานร่วมกันตามจริง โดยไม่อ้างการรับรองจากเจ้าของโปรแกรมเหล่านั้น

## หน้า Releases

ถ้าต้องการให้ผู้ใช้ดาวน์โหลดตัวที่ build แล้ว ให้แนบ ZIP และ `.sha256` ที่สร้างด้วย `npm run release` ในหน้า Releases ของบริการ Git ที่ใช้ ไม่ต้อง commit ZIP ลง source repository และไม่บีบอัดโฟลเดอร์ที่ติดตั้งใช้งานแล้วเพื่อแจก

ตัวอย่างข้อความหน้า repository:

> N3zuui Studio เป็นตัวกลาง MCP แบบหลาย worker สำหรับ Windows โค้ดและแบรนด์ที่สร้างโดย N3zuui อยู่ภายใต้ Proprietary License ส่วนโค้ด upstream และโปรแกรมภายนอกยังอยู่ตาม license ของเจ้าของเดิม โปรแกรมนี้เป็นโครงการอิสระ ไม่ใช่ผลิตภัณฑ์ทางการของ OpenAI หรือ Desktop Commander

## DWB launcher

`DWB MCP Studio.exe` เป็น launcher ของ N3zuui เอง สร้างจาก `scripts/launcher.cs` ด้วย `scripts/build-launcher.ps1` พร้อมไอคอนจากโลโก้ผู้พัฒนา จึงรวมใน Git และ release ได้ภายใต้ LICENSE ของ N3zuui สำหรับส่วนต้นฉบับของ N3zuui; โค้ด upstream และโปรแกรมภายนอกยังดาวน์โหลด/ใช้ตาม license เดิม
