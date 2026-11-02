import { Hero } from "@/components/landing/Hero";
import { JourneyArt } from "@/components/landing/JourneyArt";

/** The first page people land on. "Start a test" opens the setup form at /new. */
export default function HomePage() {
  return <Hero art={<JourneyArt />} />;
}
