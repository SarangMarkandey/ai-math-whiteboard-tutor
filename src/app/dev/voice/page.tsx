import { notFound } from "next/navigation";
import VoicePreview from "@/components/VoicePreview";
export default function DevVoice() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Math Tutor</h1>
        <span>Development voice laboratory</span>
        <a href="/">Return to learning</a>
      </header>
      <VoicePreview />
    </main>
  );
}
