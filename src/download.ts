import axios from "axios";
import * as cheerio from "cheerio";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import tmdbScrape from "./vidsrc";
import { spawn } from "child_process";
import FfmpegProgressReporter from "./progress-reporter";
import ffmpegPath from "ffmpeg-static";

const downloadM3U8 = (
  m3u8Url: string,
  outputFilePath: string,
  referer: string,
) => {
  const ffmpegHeaders = [
    "'user-agent: Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0'$",
    "'accept: */*'$",
    "'accept-language: en-US,en;q=0.5'$",
    `'referer: ${referer}/'$`,
    `'origin: ${referer}'$`,
    "'dnt: 1'$",
    "'sec-fetch-dest: empty'$",
    "'sec-fetch-mode: cors'$",
    "'sec-fetch-site: cross-site'$",
    "'sec-gpc: 1'$",
    "'te: trailers'$",
    "'Accept-Encoding: deflate, gzip, zstd'$",
  ];
  return new Promise((resolve, reject) => {
    const command = `${ffmpegPath!} -y -headers ${ffmpegHeaders.join("'\\r\\n'")} -i '${m3u8Url}' -c copy "${outputFilePath}"`;
    console.log(`Spawning ffmpeg with command: ${command}`);
    const cmd = spawn(command, [], { shell: true });
    const reporter = new FfmpegProgressReporter();

    cmd.stdout.on("data", (_) => {});
    cmd.stderr.on("data", function (data) {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) {
          reporter.handleIncomingLine(line);
        }
      }
    });

    cmd.on("exit", (exitCode) => {
      if (exitCode === 0) {
        resolve(exitCode);
      } else {
        reject(new Error(`Process exited with code: ${exitCode}`));
      }
    });

    cmd.on("error", (error) => {
      reject(error);
    });
  });
};

const searchIMDb = async (tvShow: string) => {
  const searchUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(tvShow)}&s=tt&ttype=tv&ref_=fn_tv`;
  const response = await axios.get(searchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 6.3; Win 64 ; x64) Apple WeKit /537.36(KHTML , like Gecko) Chrome/80.0.3987.162 Safari/537.36",
    },
  });
  const $ = cheerio.load(response.data);

  const showLink = $(
    ".ipc-metadata-list>li>div.ipc-metadata-list-summary-item__c>div a",
  ).attr("href");
  console.log(`Found TV show ${tvShow} at ${showLink}`);
  return showLink ? showLink.split("/")[2] : null; // Extracting IMDb ID
};

const getShowDetails = async (imdbId: string) => {
  const seasonsUrl = `https://www.imdb.com/title/${imdbId}/episodes`;
  const response = await axios.get(seasonsUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 6.3; Win 64 ; x64) Apple WeKit /537.36(KHTML , like Gecko) Chrome/80.0.3987.162 Safari/537.36",
    },
  });

  const $ = cheerio.load(response.data);

  const seasonsCount = $(
    "div.ipc-tabs.ipc-tabs--base.ipc-tabs--align-left.ipc-tabs--display-chip.ipc-tabs--inherit > ul.ipc-tabs.ipc-tabs--base.ipc-tabs--align-left a",
  ).length;
  const seasons = [];

  for (let season = 1; season <= seasonsCount; season++) {
    const episodesUrl = `https://www.imdb.com/title/${imdbId}/episodes?season=${season}`;

    const episodeResponse = await axios.get(episodesUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 6.3; Win 64 ; x64) Apple WeKit /537.36(KHTML , like Gecko) Chrome/80.0.3987.162 Safari/537.36",
      },
    });

    const episodePage = cheerio.load(episodeResponse.data);
    const episodeCount = episodePage(".episode-item-wrapper").length;
    console.log(
      `Found Season ${season} with ${episodeCount} episodes for TV show ${imdbId}`,
    );
    seasons.push({ season, episodes: episodeCount });
  }

  return seasons;
};

const createDirectory = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

function formatNumber(num: number) {
  return num.toString().padStart(2, "0");
}

const main = async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("Enter the TV show name: ", async (tvShow) => {
    try {
      const imdbId = await searchIMDb(tvShow);

      if (!imdbId) {
        console.error("TV show not found");
        rl.close();
        return;
      }

      const seasons = await getShowDetails(imdbId);
      const baseDir = path.join(process.env.HOME || "", "Videos", tvShow);

      for (const { season, episodes } of seasons) {
        const seasonDir = path.join(baseDir, `Season ${season}`);
        createDirectory(seasonDir); // Create season directory
        console.log(
          `Processing ${tvShow} [${imdbId}] - S${formatNumber(season)}`,
        );
        for (let episode = 1; episode <= episodes; episode++) {
          const outputFilePath = path.join(
            seasonDir,
            `${tvShow} - S${formatNumber(season)}E${formatNumber(episode)}.mp4`,
          );
          console.log(
            `- Scraping ${tvShow} [${imdbId}] - S${formatNumber(season)}E${formatNumber(episode)}...`,
          );
          if (fs.existsSync(outputFilePath)) {
            console.log(`-- File already downloaded, skipping...\n\n`);
            continue;
          }
          const response = await tmdbScrape(imdbId, "tv", season, episode);
          const streamUrl = response[0].stream;
          console.log(`-- Downloading from ${streamUrl}`);

          await downloadM3U8(streamUrl!, outputFilePath, response[0].referer);
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      rl.close();
    }
  });
};

main().catch(console.error);
