import "dotenv/config";
import { readFileSync } from "fs";
import { transcribeAudio } from "../services/transcription.service";
(async () => {
  for (const f of process.argv.slice(2)) {
    const buf = readFileSync(f);
    const mt = f.endsWith(".m4a") ? "audio/mp4" : "audio/wav";
    const t0 = Date.now();
    try {
      const r = await transcribeAudio({ buffer: buf, mimetype: mt, filename: f.split("/").pop()! });
      console.log(f.split("/").pop(), "->", r.provider, r.model, (Date.now() - t0) + "ms", "|", JSON.stringify(r.text));
    } catch (e: any) { console.log(f, "ERROR", e.message); }
  }
  process.exit(0);
})();
