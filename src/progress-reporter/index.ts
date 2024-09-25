export default class FfmpegProgressReporter {
  private duration: Time | null = null;
  private lastTime: Time | null = null;
  private lastSize: number | null = null;
  private lastRemaining: string = "00:00:00";
  private variantBitrate: number | null = null; // Store the variant bitrate

  constructor() {}

  private parseDuration(durationStr: string): Time {
    const match = durationStr.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
    if (!match) throw new Error("Invalid duration format");
    const [, hours, minutes, seconds, milliseconds] = match;
    return new Time(
      Number(hours),
      Number(minutes),
      Number(seconds),
      Number(milliseconds),
    );
  }

  private parseTime(timeStr: string): Time {
    const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
    if (!match) throw new Error("Invalid time format");
    const [, hours, minutes, seconds, milliseconds] = match;
    return new Time(
      Number(hours),
      Number(minutes),
      Number(seconds),
      Number(milliseconds),
    );
  }

  private updateProgressBar(currentTime: Time, currentSize: number): void {
    if (!this.duration) return;

    const currentMillis = currentTime.totalMilliseconds();
    const durationMillis = this.duration.totalMilliseconds();
    const totalDurationSeconds = durationMillis / 1000; // Convert to seconds

    const progress = Math.min((currentMillis / durationMillis) * 100, 100);
    const barLength = 50; // Length of the progress bar
    const filledLength = Math.round(barLength * (progress / 100));
    const bar = "█".repeat(filledLength) + "-".repeat(barLength - filledLength);

    // Calculate estimated remaining time
    let remaining = this.lastRemaining;
    if (this.lastTime && this.lastSize !== null) {
      const timeDiff = currentMillis - this.lastTime.totalMilliseconds();
      const sizeDiff = currentSize - this.lastSize;

      if (timeDiff > 0 && sizeDiff > 0) {
        const speed = sizeDiff / (timeDiff / 1000); // KiB/s

        // Calculate estimated final size using variant bitrate
        const estimatedFinalSize =
          (this.variantBitrate! * totalDurationSeconds) / 8 / 1024; // Convert from bits to KiB

        // Calculate remaining size
        const remainingSize = estimatedFinalSize - currentSize; // KiB left to finish
        const estimatedRemainingTime = remainingSize / speed; // seconds

        const totalSeconds = Math.max(0, Math.round(estimatedRemainingTime));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        remaining = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      }
    }

    process.stdout.write(
      `\rProgress: [${bar}] ${String(Math.round(progress)).padStart(3, " ")}% (remaining: ${remaining})`,
    );

    this.lastTime = currentTime;
    this.lastSize = currentSize;
    this.lastRemaining = remaining;

    if (progress === 100) {
      console.log("\nDownload complete!");
      console.log();
    }
  }

  public handleIncomingLine(line: string): void {
    if (line.includes("Duration:") && !this.duration) {
      const durationStr = line.match(
        /Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/,
      )?.[1];
      if (durationStr) {
        this.duration = this.parseDuration(durationStr);
        console.log(`\nTotal Duration: ${durationStr}`);
      }
    } else if (line.includes("variant_bitrate :")) {
      const bitrateStr = line.match(/variant_bitrate : (\d+)/)?.[1];
      if (bitrateStr) {
        this.variantBitrate = Number(bitrateStr); // Store in bits
      }
    } else if (this.duration && this.variantBitrate && line.includes("size=")) {
      const timeStr = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/)?.[1];
      const sizeStr = line.match(/size=\s*(\d+)KiB/)?.[1];
      if (timeStr && sizeStr) {
        const currentTime = this.parseTime(timeStr);
        const currentSize = Number(sizeStr);
        this.updateProgressBar(currentTime, currentSize);
      }
    }
  }
}

class Time {
  constructor(
    public hours: number,
    public minutes: number,
    public seconds: number,
    public milliseconds: number,
  ) {}

  public totalMilliseconds(): number {
    return (
      (this.hours * 3600 + this.minutes * 60 + this.seconds) * 1000 +
      this.milliseconds
    );
  }
}
