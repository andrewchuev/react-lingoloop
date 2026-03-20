import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type MutableRefObject,
    type ReactNode,
} from "react";

type PlayerState = "idle" | "speaking" | "paused";
type ThemeMode = "light" | "dark";
type PlaybackMode = "whole-text" | "sentence-by-sentence";

const APP_NAME = "LingoLoop";

const STORAGE_KEYS = {
    theme: "lingoloop.theme",
    text: "lingoloop.text",
    rate: "lingoloop.rate",
    repeatCount: "lingoloop.repeatCount",
    pauseBetweenRepeats: "lingoloop.pauseBetweenRepeats",
    language: "lingoloop.language",
    voice: "lingoloop.voice",
    playbackMode: "lingoloop.playbackMode",
};

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

async function delayWithStop(
    ms: number,
    stopRequestedRef: MutableRefObject<boolean>
): Promise<void> {
    const step = 50;
    let elapsed = 0;

    while (elapsed < ms && !stopRequestedRef.current) {
        const chunk = Math.min(step, ms - elapsed);
        await delay(chunk);
        elapsed += chunk;
    }
}

function getStoredString(key: string, fallback: string): string {
    if (typeof window === "undefined") {
        return fallback;
    }

    return window.localStorage.getItem(key) ?? fallback;
}

function getStoredNumber(
    key: string,
    fallback: number,
    min: number,
    max: number
): number {
    if (typeof window === "undefined") {
        return fallback;
    }

    const raw = window.localStorage.getItem(key);
    const value = raw ? Number(raw) : fallback;

    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, value));
}

function getStoredPlaybackMode(): PlaybackMode {
    const raw = getStoredString(STORAGE_KEYS.playbackMode, "whole-text");
    return raw === "sentence-by-sentence" ? "sentence-by-sentence" : "whole-text";
}

function normalizeLanguageCode(lang: string): string {
    return lang.toLowerCase().split("-")[0];
}

function matchesLanguage(voiceLang: string, selectedLanguage: string): boolean {
    return normalizeLanguageCode(voiceLang) === selectedLanguage;
}

function getLanguageLabel(lang: string): string {
    const code = normalizeLanguageCode(lang);

    try {
        return new Intl.DisplayNames(["en"], {type: "language"}).of(code) ?? code.toUpperCase();
    } catch {
        return code.toUpperCase();
    }
}

function getInitialTheme(): ThemeMode {
    if (typeof document === "undefined") {
        return "light";
    }

    return document.documentElement.getAttribute("data-theme") === "dark"
        ? "dark"
        : "light";
}

function splitTextIntoSentences(text: string, lang: string): string[] {
    const trimmed = text.trim();

    if (!trimmed) {
        return [];
    }

    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
        try {
            const segmenter = new Intl.Segmenter(lang, {granularity: "sentence"});
            const segments = Array.from(segmenter.segment(trimmed), ({segment}) =>
                segment.trim()
            ).filter(Boolean);

            if (segments.length > 0) {
                return segments;
            }
        } catch {
            // Fallback below
        }
    }

    return trimmed
        .replace(/\r\n/g, "\n")
        .split(/\n+/)
        .flatMap((block) => {
            const matches = block.match(/[^.!?…。！？\n]+[.!?…。！？]?/gu);
            return matches ? matches.map((item) => item.trim()).filter(Boolean) : [];
        })
        .filter(Boolean);
}

type SpeakOnceParams = {
    text: string;
    rate: number;
    voice: SpeechSynthesisVoice | null;
    lang: string;
};

function speakOnce(params: SpeakOnceParams): Promise<void> {
    const {text, rate, voice, lang} = params;

    return new Promise((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);

        utterance.text = text;
        utterance.rate = rate;
        utterance.lang = lang;

        if (voice) {
            utterance.voice = voice;
        }

        utterance.onend = () => resolve();

        utterance.onerror = (event) => {
            reject(new Error(event.error || "Speech synthesis error"));
        };

        window.speechSynthesis.speak(utterance);
    });
}

function ThemeIcon({theme}: { theme: ThemeMode }) {
    if (theme === "dark") {
        return (
            <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 2v2.5"/>
                <path d="M12 19.5V22"/>
                <path d="M2 12h2.5"/>
                <path d="M19.5 12H22"/>
                <path d="M4.93 4.93l1.77 1.77"/>
                <path d="M17.3 17.3l1.77 1.77"/>
                <path d="M17.3 6.7l1.77-1.77"/>
                <path d="M4.93 19.07l1.77-1.77"/>
            </svg>
        );
    }

    return (
        <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>
        </svg>
    );
}

function ControlCard({
                         label,
                         children,
                         className = "",
                     }: {
    label: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={[
                "rounded-2xl border border-slate-200 bg-slate-50 p-4",
                "dark:border-slate-800 dark:bg-slate-950/60",
                className,
            ].join(" ")}
        >
            <label className="mb-3 block text-sm font-medium text-slate-700 dark:text-slate-200">
                {label}
            </label>
            {children}
        </div>
    );
}

export default function LingoLoopReader() {
    const [text, setText] = useState<string>(
        getStoredString(
            STORAGE_KEYS.text,
            "Hello! Welcome to LingoLoop. Paste any text here, choose a narrator language and voice, then practice listening as many times as you need."
        )
    );
    const [rate, setRate] = useState<number>(
        getStoredNumber(STORAGE_KEYS.rate, 0.9, 0.5, 1.5)
    );
    const [repeatCount, setRepeatCount] = useState<number>(
        getStoredNumber(STORAGE_KEYS.repeatCount, 2, 1, 20)
    );
    const [pauseBetweenRepeats, setPauseBetweenRepeats] = useState<number>(
        getStoredNumber(STORAGE_KEYS.pauseBetweenRepeats, 800, 0, 10000)
    );
    const [allVoices, setAllVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [languageCode, setLanguageCode] = useState<string>(
        getStoredString(STORAGE_KEYS.language, "en")
    );
    const [voiceURI, setVoiceURI] = useState<string>(
        getStoredString(STORAGE_KEYS.voice, "")
    );
    const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(getStoredPlaybackMode);
    const [playerState, setPlayerState] = useState<PlayerState>("idle");
    const [isSupported, setIsSupported] = useState<boolean>(true);
    const [error, setError] = useState<string>("");
    const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
    const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number | null>(null);

    const stopRequestedRef = useRef<boolean>(false);

    const languageOptions = useMemo(() => {
        const uniqueCodes = Array.from(
            new Set(allVoices.map((voice) => normalizeLanguageCode(voice.lang)))
        );

        return uniqueCodes
            .map((code) => ({
                code,
                label: getLanguageLabel(code),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [allVoices]);

    const filteredVoices = useMemo(() => {
        return allVoices
            .filter((voice) => matchesLanguage(voice.lang, languageCode))
            .sort((a, b) => {
                if (a.default !== b.default) {
                    return a.default ? -1 : 1;
                }

                return a.name.localeCompare(b.name);
            });
    }, [allVoices, languageCode]);

    const selectedVoice = useMemo(() => {
        return filteredVoices.find((voice) => voice.voiceURI === voiceURI) ?? null;
    }, [filteredVoices, voiceURI]);

    const selectedLanguageLabel = useMemo(() => {
        return languageOptions.find((option) => option.code === languageCode)?.label ?? "Unknown";
    }, [languageCode, languageOptions]);

    const selectedVoiceLabel = useMemo(() => {
        if (!selectedVoice) {
            return "No voice selected";
        }

        return `${selectedVoice.name} (${selectedVoice.lang})${selectedVoice.default ? " — Default" : ""}`;
    }, [selectedVoice]);

    const playbackLang = selectedVoice?.lang || languageCode || "en";

    const sentenceSegments = useMemo(() => {
        return splitTextIntoSentences(text, playbackLang);
    }, [text, playbackLang]);

    const currentSentenceText = useMemo(() => {
        if (currentSentenceIndex === null) {
            return "";
        }

        return sentenceSegments[currentSentenceIndex] ?? "";
    }, [currentSentenceIndex, sentenceSegments]);

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem(STORAGE_KEYS.theme, theme);
    }, [theme]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.text, text);
    }, [text]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.rate, String(rate));
    }, [rate]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.repeatCount, String(repeatCount));
    }, [repeatCount]);

    useEffect(() => {
        localStorage.setItem(
            STORAGE_KEYS.pauseBetweenRepeats,
            String(pauseBetweenRepeats)
        );
    }, [pauseBetweenRepeats]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.language, languageCode);
    }, [languageCode]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.voice, voiceURI);
    }, [voiceURI]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.playbackMode, playbackMode);
    }, [playbackMode]);

    useEffect(() => {
        const supported =
            typeof window !== "undefined" &&
            "speechSynthesis" in window &&
            "SpeechSynthesisUtterance" in window;

        setIsSupported(supported);

        if (!supported) {
            return;
        }

        const synth = window.speechSynthesis;

        const loadVoices = () => {
            const nextVoices = synth.getVoices().slice().sort((a, b) => {
                const langCompare = a.lang.localeCompare(b.lang);
                if (langCompare !== 0) {
                    return langCompare;
                }

                return a.name.localeCompare(b.name);
            });

            setAllVoices(nextVoices);
        };

        loadVoices();
        synth.addEventListener("voiceschanged", loadVoices);

        return () => {
            stopRequestedRef.current = true;
            synth.cancel();
            synth.removeEventListener("voiceschanged", loadVoices);
        };
    }, []);

    useEffect(() => {
        if (!languageOptions.length) {
            return;
        }

        const hasSelectedLanguage = languageOptions.some(
            (option) => option.code === languageCode
        );

        if (hasSelectedLanguage) {
            return;
        }

        const fallbackLanguage =
            languageOptions.find((option) => option.code === "en")?.code ??
            languageOptions[0]?.code ??
            "en";

        setLanguageCode(fallbackLanguage);
    }, [languageOptions, languageCode]);

    useEffect(() => {
        if (!filteredVoices.length) {
            setVoiceURI("");
            return;
        }

        const hasSelectedVoice = filteredVoices.some(
            (voice) => voice.voiceURI === voiceURI
        );

        if (hasSelectedVoice) {
            return;
        }

        const fallbackVoice =
            filteredVoices.find((voice) => voice.default) ?? filteredVoices[0];

        setVoiceURI(fallbackVoice.voiceURI);
    }, [filteredVoices, voiceURI]);

    const handlePlay = async () => {
        if (!isSupported) {
            return;
        }

        const trimmedText = text.trim();

        if (!trimmedText) {
            setError("Please paste some text first.");
            return;
        }

        if (repeatCount < 1) {
            setError("Repeat count must be at least 1.");
            return;
        }

        if (!filteredVoices.length) {
            setError("No voices are available for the selected language.");
            return;
        }

        const chunks =
            playbackMode === "sentence-by-sentence"
                ? splitTextIntoSentences(trimmedText, playbackLang)
                : [trimmedText];

        if (!chunks.length) {
            setError("No readable text segments were found.");
            return;
        }

        setError("");
        stopRequestedRef.current = false;
        setCurrentSentenceIndex(playbackMode === "sentence-by-sentence" ? 0 : null);

        window.speechSynthesis.cancel();
        setPlayerState("speaking");

        try {
            outerLoop: for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
                if (stopRequestedRef.current) {
                    break;
                }

                if (playbackMode === "sentence-by-sentence") {
                    setCurrentSentenceIndex(chunkIndex);
                }

                for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
                    if (stopRequestedRef.current) {
                        break outerLoop;
                    }

                    await speakOnce({
                        text: chunks[chunkIndex],
                        rate,
                        voice: selectedVoice,
                        lang: playbackLang,
                    });

                    const isLastRepeat = repeatIndex === repeatCount - 1;
                    const isLastChunk = chunkIndex === chunks.length - 1;

                    if (!isLastRepeat || !isLastChunk) {
                        await delayWithStop(pauseBetweenRepeats, stopRequestedRef);
                    }
                }
            }
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Unknown speech synthesis error";
            setError(message);
        } finally {
            setCurrentSentenceIndex(null);
            setPlayerState("idle");
        }
    };

    const handlePause = () => {
        if (!isSupported) {
            return;
        }

        window.speechSynthesis.pause();
        setPlayerState("paused");
    };

    const handleResume = () => {
        if (!isSupported) {
            return;
        }

        window.speechSynthesis.resume();
        setPlayerState("speaking");
    };

    const handleStop = () => {
        if (!isSupported) {
            return;
        }

        stopRequestedRef.current = true;
        window.speechSynthesis.cancel();
        setCurrentSentenceIndex(null);
        setPlayerState("idle");
    };

    const toggleTheme = () => {
        setTheme((prev) => (prev === "dark" ? "light" : "dark"));
    };

    if (!isSupported) {
        return (
            <div>
                <div className="mx-auto max-w-3xl px-4 py-10">
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
                        <p className="mt-3 text-slate-600 dark:text-slate-300">
                            Your browser does not support Speech Synthesis.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">{APP_NAME}</h1>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                            Multilingual text-to-speech listening practice.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={toggleTheme}
                        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                        <span className="sr-only">
                            {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                        </span>
                        <ThemeIcon theme={theme}/>
                    </button>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xl shadow-slate-200/40 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-black/20 sm:p-6">
                    <div className="mb-6">
                        <label
                            htmlFor="reader-text"
                            className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200"
                        >
                            Text
                        </label>

                        <textarea
                            id="reader-text"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            rows={5}
                            placeholder="Paste any text here..."
                            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-800"
                        />
                    </div>


                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
                        <ControlCard label="Narrator language" className="xl:col-span-3">
                            <select
                                id="language"
                                value={languageCode}
                                onChange={(e) => setLanguageCode(e.target.value)}
                                disabled={languageOptions.length <= 1}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-70 focus:border-slate-400 focus:ring-4 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-800"
                            >
                                {languageOptions.map((option) => (
                                    <option key={option.code} value={option.code}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </ControlCard>

                        <ControlCard label="Voice" className="xl:col-span-5">
                            <select
                                id="voice"
                                value={voiceURI}
                                onChange={(e) => setVoiceURI(e.target.value)}
                                title={selectedVoiceLabel}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-800"
                            >
                                {filteredVoices.map((voice) => (
                                    <option key={voice.voiceURI} value={voice.voiceURI}>
                                        {voice.name} ({voice.lang})
                                        {voice.default ? " — Default" : ""}
                                    </option>
                                ))}
                            </select>

                            <div className="mt-2 truncate text-xs text-slate-500 dark:text-slate-400">
                                {selectedVoiceLabel}
                            </div>
                        </ControlCard>

                        <ControlCard
                            label={`Reading speed: ${rate.toFixed(1)}x`}
                            className="xl:col-span-4"
                        >
                            <input
                                id="rate"
                                type="range"
                                min="0.5"
                                max="1.5"
                                step="0.1"
                                value={rate}
                                onChange={(e) => setRate(Number(e.target.value))}
                                className="mt-2 w-full accent-slate-900 dark:accent-slate-100"
                            />

                            <div className="mt-3 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                                <span>0.5x</span>
                                <span>1.0x</span>
                                <span>1.5x</span>
                            </div>
                        </ControlCard>

                        <ControlCard label="Repeats" className="xl:col-span-3">
                            <input
                                id="repeatCount"
                                type="number"
                                min="1"
                                max="20"
                                value={repeatCount}
                                onChange={(e) => setRepeatCount(Number(e.target.value))}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-800"
                            />
                        </ControlCard>

                        <ControlCard label="Pause between repeats (ms)" className="xl:col-span-3">
                            <input
                                id="pauseBetweenRepeats"
                                type="number"
                                min="0"
                                max="10000"
                                step="100"
                                value={pauseBetweenRepeats}
                                onChange={(e) => setPauseBetweenRepeats(Number(e.target.value))}
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-800"
                            />
                        </ControlCard>

                        <ControlCard label="Playback mode" className="xl:col-span-6 flex flex-col gap-3">
                            <div className="flex justify-between gap-2">

                                <div className="inline-flex rounded-2xl border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-950/60">
                                    <button
                                        type="button"
                                        onClick={() => setPlaybackMode("whole-text")}
                                        className={[
                                            "rounded-xl px-3 py-2 text-sm transition",
                                            playbackMode === "whole-text"
                                                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                                                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
                                        ].join(" ")}
                                    >
                                        Whole text
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setPlaybackMode("sentence-by-sentence")}
                                        className={[
                                            "rounded-xl px-3 py-2 text-sm transition",
                                            playbackMode === "sentence-by-sentence"
                                                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                                                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
                                        ].join(" ")}
                                    >
                                        Sentence by sentence
                                    </button>
                                </div>

                                <div className="flex items-center text-xs text-slate-500 dark:text-slate-400">
                                    {playbackMode === "sentence-by-sentence"
                                        ? `Detected sentences: ${sentenceSegments.length}`
                                        : "The entire text will be played as one block."}
                                </div>
                            </div>


                        </ControlCard>


                    </div>

                    {playbackMode === "sentence-by-sentence" && (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                                    Current sentence
                                </div>

                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                    {currentSentenceIndex !== null
                                        ? `${currentSentenceIndex + 1}/${sentenceSegments.length}`
                                        : `0/${sentenceSegments.length}`}
                                </div>
                            </div>

                            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                                {currentSentenceText || "Start playback to focus on one sentence at a time."}
                            </div>
                        </div>
                    )}

                    <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-12">
                        <div className="xl:col-span-4">
                            <div className="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={handlePlay}
                                    disabled={playerState === "speaking"}
                                    className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                                >
                                    Start
                                </button>

                                <button
                                    type="button"
                                    onClick={handlePause}
                                    disabled={playerState !== "speaking"}
                                    className="rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                    Pause
                                </button>

                                <button
                                    type="button"
                                    onClick={handleResume}
                                    disabled={playerState !== "paused"}
                                    className="rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                    Resume
                                </button>

                                <button
                                    type="button"
                                    onClick={handleStop}
                                    disabled={playerState === "idle"}
                                    className="rounded-2xl border border-rose-300 bg-rose-50 px-5 py-2.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60"
                                >
                                    Stop
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:col-span-8">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950/60">
                                <span className="font-medium">Status:</span>{" "}
                                <span className="text-slate-600 dark:text-slate-300">{playerState}</span>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950/60">
                                <span className="font-medium">Language:</span>{" "}
                                <span className="text-slate-600 dark:text-slate-300">
                                    {selectedLanguageLabel}
                                </span>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950/60">
                                <span className="font-medium">Available voices:</span>{" "}
                                <span className="text-slate-600 dark:text-slate-300">
                                    {filteredVoices.length}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                        {languageOptions.length <= 1
                            ? "Only one narrator language is currently available in your browser and operating system."
                            : "Voice availability depends on your browser and operating system."}
                    </div>

                    {error && (
                        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                            {error}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}