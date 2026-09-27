# ส่วนประกอบประจำ N3zuui

Setup และ Start MCP ใช้โปรแกรมสองตัวใน `external` ของโฟลเดอร์ N3zuui ที่เปิดอยู่เท่านั้น ไม่มีการเลือก exe หรือ worker จาก PATH/โปรไฟล์ของแอปอื่น

| ส่วนประกอบ           | รุ่น   | แหล่งต้นทาง                                                                              | ตำแหน่งหลังติดตั้ง                                                        |
| -------------------- | ------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Desktop Commander    | 0.2.50 | [npm ของเจ้าของ](https://www.npmjs.com/package/@wonderwhy-er/desktop-commander/v/0.2.50) | `external/desktop-commander/node_modules/@wonderwhy-er/desktop-commander` |
| OpenAI tunnel-client | 0.0.11 | [OpenAI release](https://github.com/openai/tunnel-client/releases/tag/v0.0.11)           | `external/tunnel-client`                                                  |

กด **ติดตั้งและเตรียมใช้งาน** เพื่อดาวน์โหลดผ่าน HTTPS ด้วยเครื่องของผู้ใช้เอง การติดตั้ง Desktop Commander ใช้ npm registry ต้นทางและตรึงเวอร์ชันตรงตัว ส่วน ZIP ของ tunnel-client เลือก Windows amd64 หรือ arm64 และตรวจ SHA-256 ที่ตรึงไว้จาก release ก่อนแตกไฟล์ ไฟล์ LICENSE และ companion ที่เจ้าของใส่ใน ZIP จะอยู่ข้าง tunnel-client ตามแพ็กเกจต้นทาง

ไม่มี `external`, binary ของเจ้าของอื่น, node_modules, API key หรือข้อมูล runtime ใน ZIP ที่ N3zuui แจก

## อัปเดตและลองใหม่

- ของที่พร้อมและเป็นรุ่นที่รองรับจะถูกใช้ซ้ำ ไม่ดาวน์โหลดใหม่
- การดาวน์โหลดใช้โฟลเดอร์ staging ชื่อใหม่ใต้ `external` แล้วค่อยย้ายมาเป็นโฟลเดอร์ใช้งานหลังตรวจ ไฟล์จากการดาวน์โหลดที่ล้มเหลวจะไม่ถูกนำมารัน
- หากโฟลเดอร์ใช้งานถูกแก้จนไม่ครบหรือเปลี่ยนเป็นรุ่นอื่น ตัวติดตั้งจะหยุดพร้อมระบุชื่อโฟลเดอร์ ให้หยุดงานก่อน เปลี่ยนชื่อโฟลเดอร์นั้นเพื่อเก็บสำรอง แล้วกดติดตั้งใหม่
- ไม่รองรับ junction/symlink ที่ชี้ `external` ไปใช้โปรแกรมร่วมกับแอปอื่น
- เมื่อติดตั้ง N3zuui รุ่นใหม่ในโฟลเดอร์ใหม่ Setup จะคัดลอกส่วนประกอบรุ่นที่รองรับจาก N3zuui เดิมที่ config ระบุมาไว้ใน `external` ของรุ่นใหม่ แล้วปรับ path ให้ ข้อมูล workspace/key อยู่ใน data directory เดิม ดู [วิธีอัปเดต](UPDATING-TH.md)
- CLI สำหรับพัฒนาและ integration ยังรับ worker path เพื่อใช้ fixture และทดสอบ upstream ได้ การตรวจเฉพาะโฟลเดอร์นี้บังคับใน Setup และหน้า OpenAI Start MCP

Tunnel ID เป็นการเชื่อมต่อฝั่ง OpenAI จึงยังต้องแยกจาก tunnel ที่โปรแกรมอื่นกำลังใช้อยู่ แม้ติดตั้ง binary คนละชุดแล้ว
