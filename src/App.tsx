import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { 
  Mic, 
  MicOff, 
  Send, 
  Users, 
  MessageSquare, 
  LogOut, 
  Hash, 
  Volume2, 
  VolumeX, 
  Smile, 
  Crown,
  Settings,
  X,
  MessageCircle,
  Bell,
  Play,
  Square
} from "lucide-react";
import { User as UserType, Message } from "./types";

type NoiseSuppressionLevel = "off" | "low" | "medium" | "high";
type VoiceQualityProfile = "stable" | "balanced" | "quality";

const STORAGE_KEYS = {
  nickname: "speakwise:nickname",
  notificationSound: "speakwise:notificationSound",
  voiceQualityProfile: "speakwise:voiceQualityProfile",
};

const VOICE_QUALITY_SETTINGS: Record<
  VoiceQualityProfile,
  {
    label: string;
    bitrate: number;
    sampleRate: number;
    dtx: boolean;
  }
> = {
  stable: {
    label: "Stabil",
    bitrate: 48000,
    sampleRate: 48000,
    dtx: false,
  },
  balanced: {
    label: "Dengeli",
    bitrate: 80000,
    sampleRate: 48000,
    dtx: false,
  },
  quality: {
    label: "Kaliteli",
    bitrate: 128000,
    sampleRate: 48000,
    dtx: false,
  },
};

const getSavedValue = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const setSavedValue = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in private or locked-down browser modes.
  }
};

// Standard WebRTC ICE configuration with public Google STUN servers
const iceConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// Turkish placeholder names for instant fun access
const RANDOM_NICKNAMES = [
  "KaraŞövalye", "YıldızGezgini", "PikselAvcısı", "KozmikGamer", 
  "SiberGezgin", "GölgeEfendisi", "FırtınaKıran", "YazılımGeliştirici",
  "BulutMühendisi", "KriptoKralı", "AlfaGamer", "KuantumLideri"
];

const getAudioConstraints = (
  selectedMicId: string,
  noiseSuppressionLevel: NoiseSuppressionLevel,
  voiceQualityProfile: VoiceQualityProfile,
  deviceMode: "ideal" | "exact" = "ideal"
): MediaTrackConstraints => {
  const echoCancellationEnabled = noiseSuppressionLevel !== "off";
  const noiseSuppressionEnabled = noiseSuppressionLevel === "medium" || noiseSuppressionLevel === "high";
  const autoGainControlEnabled = noiseSuppressionLevel === "high";
  const qualitySettings = VOICE_QUALITY_SETTINGS[voiceQualityProfile];

  return {
    ...(selectedMicId ? { deviceId: { [deviceMode]: selectedMicId } } : {}),
    echoCancellation: echoCancellationEnabled,
    noiseSuppression: noiseSuppressionEnabled,
    autoGainControl: autoGainControlEnabled,
    channelCount: 1,
    sampleRate: qualitySettings.sampleRate,
    sampleSize: 16,
  };
};

const getMicrophoneErrorMessage = (err: unknown) => {
  const errorName = err instanceof DOMException ? err.name : "";

  if (errorName === "NotAllowedError" || errorName === "SecurityError") {
    return "Tarayıcı mikrofon iznini kapatmış. Adres çubuğundaki kilit simgesinden mikrofonu izinli yap.";
  }

  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "Mikrofon bulunamadı. Kulaklığı veya mikrofonu takıp tekrar dene.";
  }

  if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    return "Mikrofon başka bir uygulama tarafından kullanılıyor olabilir.";
  }

  return "Mikrofon açılamadı. Varsayılan cihazı kontrol edip tekrar dene.";
};

// Helper to play synthesized connect/disconnect audio cues (resembling Discord sounds)
const playAudioCue = (type: "join" | "leave" | "msg") => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === "join") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(330, audioCtx.currentTime); // E4
      osc.frequency.exponentialRampToValueAtTime(660, audioCtx.currentTime + 0.25); // E5
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } else if (type === "leave") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, audioCtx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(260, audioCtx.currentTime + 0.3); // C4
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } else if (type === "msg") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      osc.frequency.setValueAtTime(800, audioCtx.currentTime + 0.08);
      gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    }
  } catch (e) {
    console.warn("Audio cue context failed to start:", e);
  }
};

// Global DOM Helper to manage programmatic peer audio elements
const playStream = (userId: string, stream: MediaStream) => {
  let audio = document.getElementById(`audio-${userId}`) as HTMLAudioElement;
  if (!audio) {
    audio = document.createElement("audio");
    audio.id = `audio-${userId}`;
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    audio.volume = 1;
    audio.style.display = "none";
    document.body.appendChild(audio);
  }
  audio.srcObject = stream;
  audio.play().catch((err) => {
    console.warn("Remote audio playback was blocked:", err);
  });
};

const stopStream = (userId: string) => {
  const audio = document.getElementById(`audio-${userId}`) as HTMLAudioElement;
  if (audio) {
    audio.srcObject = null;
    audio.remove();
  }
};

export default function App() {
  // State
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  const [users, setUsers] = useState<UserType[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<{ id: string; nickname: string }[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isTalking, setIsTalking] = useState(false); // local voice volume activity detector
  const [roomKey, setRoomKey] = useState("");
  const [roomKeyRequired, setRoomKeyRequired] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [activeMicLabel, setActiveMicLabel] = useState("");
  const [noiseSuppressionLevel, setNoiseSuppressionLevel] = useState<NoiseSuppressionLevel>("medium");
  const [voiceQualityProfile, setVoiceQualityProfile] = useState<VoiceQualityProfile>("balanced");
  const [voiceError, setVoiceError] = useState("");
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameSaved, setNicknameSaved] = useState(false);
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [micMonitorEnabled, setMicMonitorEnabled] = useState(false);
  const [micMonitorError, setMicMonitorError] = useState("");
  const autoJoinAttemptedRef = useRef(false);

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const micMonitorStreamRef = useRef<MediaStream | null>(null);
  const micMonitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const notificationSoundEnabledRef = useRef(true);
  const voiceQualityProfileRef = useRef<VoiceQualityProfile>("balanced");
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const savedNickname = getSavedValue(STORAGE_KEYS.nickname);
    const randomPick = RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)];
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const initialNickname = savedNickname || `${randomPick}#${randomNum}`;
    const savedNotificationSound = getSavedValue(STORAGE_KEYS.notificationSound);
    const savedVoiceQualityProfile = getSavedValue(STORAGE_KEYS.voiceQualityProfile) as VoiceQualityProfile | null;

    setNickname(initialNickname);
    setNicknameDraft(initialNickname);
    setNotificationSoundEnabled(savedNotificationSound !== "false");
    if (savedVoiceQualityProfile && savedVoiceQualityProfile in VOICE_QUALITY_SETTINGS) {
      setVoiceQualityProfile(savedVoiceQualityProfile);
    }
  }, []);

  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) SpeakWise` : "SpeakWise";
  }, [unreadCount]);

  useEffect(() => {
    notificationSoundEnabledRef.current = notificationSoundEnabled;
    setSavedValue(STORAGE_KEYS.notificationSound, String(notificationSoundEnabled));
  }, [notificationSoundEnabled]);

  useEffect(() => {
    voiceQualityProfileRef.current = voiceQualityProfile;
    setSavedValue(STORAGE_KEYS.voiceQualityProfile, voiceQualityProfile);
  }, [voiceQualityProfile]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setUnreadCount(0);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
      document.title = "SpeakWise";
    };
  }, []);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then((config) => setRoomKeyRequired(Boolean(config.roomKeyRequired)))
      .catch(() => setRoomKeyRequired(false))
      .finally(() => setConfigLoaded(true));
  }, []);

  useEffect(() => {
    if (!configLoaded || roomKeyRequired || joined || isJoining || !nickname || autoJoinAttemptedRef.current) return;

    autoJoinAttemptedRef.current = true;
    handleJoin();
  }, [configLoaded, roomKeyRequired, joined, isJoining, nickname]);

  const loadAudioDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones = devices.filter((device) => device.kind === "audioinput");
      setAudioDevices(microphones);

      if (!selectedMicId && microphones[0]?.deviceId) {
        setSelectedMicId(microphones[0].deviceId);
      }
    } catch (err) {
      console.warn("Audio device list could not be loaded:", err);
    }
  };

  useEffect(() => {
    loadAudioDevices();

    if (!navigator.mediaDevices) return;
    navigator.mediaDevices.addEventListener?.("devicechange", loadAudioDevices);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", loadAudioDevices);
  }, [selectedMicId]);

  // Scroll chats to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingUsers]);

  // Clean up all audio/WebRTC resources on unmount
  useEffect(() => {
    return () => {
      disconnectVoice();
      stopMicMonitor();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Monitor microphone volume for talk status indicator
  useEffect(() => {
    if (!localStream) {
      setIsTalking(false);
      return;
    }

    let intervalId: any;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(localStream);
      source.connect(analyser);
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (isMuted) {
          setIsTalking(false);
          return;
        }
        analyser.getByteFrequencyData(dataArray);
        let values = 0;
        for (let i = 0; i < bufferLength; i++) {
          values += dataArray[i];
        }
        const average = values / bufferLength;
        setIsTalking(average > 8); // speech detection threshold
      };

      intervalId = setInterval(checkVolume, 150);
    } catch (err) {
      console.warn("Microphone analyser setup failed:", err);
    }

    return () => {
      clearInterval(intervalId);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [localStream, isMuted]);

  // Handle Nickname Login & Server Connection
  const handleJoin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!nickname.trim()) return;
    if (roomKeyRequired && !roomKey.trim()) {
      setJoinError("Oda anahtarını yazmalısın.");
      return;
    }

    setJoinError("");
    setIsJoining(true);

    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("user:join", { nickname, roomKey: roomKey.trim() });
    });

    socket.on("connect_error", () => {
      setIsJoining(false);
      setJoinError("Sunucuya bağlanılamadı. Birazdan tekrar dene.");
    });

    socket.on("join:error", ({ message }: { message: string }) => {
      setIsJoining(false);
      setJoinError(message || "Odaya girilemedi.");
      socket.disconnect();
    });

    // Handle full list and history sync
    socket.on("room:state", ({ users, messages }: { users: UserType[]; messages: Message[] }) => {
      setUsers(users);
      setMessages(messages);
      const currentUser = users.find((user) => user.id === socket.id);
      if (currentUser) {
        setNickname(currentUser.nickname);
        setNicknameDraft(currentUser.nickname);
        setSavedValue(STORAGE_KEYS.nickname, currentUser.nickname);
      }
      setJoined(true);
      setIsJoining(false);
      playAudioCue("join");
    });

    // Handle online statuses
    socket.on("user:connected", (newUser: UserType) => {
      setUsers((prev) => {
        if (prev.some((u) => u.id === newUser.id)) return prev;
        return [...prev, newUser];
      });
    });

    socket.on("user:disconnected", ({ id }: { id: string; nickname: string }) => {
      setUsers((prev) => prev.filter((u) => u.id !== id));
      setTypingUsers((prev) => prev.filter((u) => u.id !== id));
      // Close WebRTC peer connection if active
      if (peersRef.current.has(id)) {
        peersRef.current.get(id)?.close();
        peersRef.current.delete(id);
      }
      pendingCandidatesRef.current.delete(id);
      stopStream(id);
    });

    socket.on("user:updated", (updatedUser: UserType) => {
      setUsers((prev) => prev.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
      if (updatedUser.id === socket.id) {
        setNickname(updatedUser.nickname);
        setNicknameDraft(updatedUser.nickname);
        setSavedValue(STORAGE_KEYS.nickname, updatedUser.nickname);
      }
    });

    // Handle incoming text message
    socket.on("chat:message", (newMessage: Message) => {
      setMessages((prev) => [...prev, newMessage]);
      if (newMessage.senderId !== socket.id) {
        if (notificationSoundEnabledRef.current) {
          playAudioCue("msg");
        }
        if (document.hidden) {
          setUnreadCount((count) => count + 1);
        }
      }
    });

    // Handle typing status updates
    socket.on("chat:typing", ({ id, nickname, isTyping }: { id: string; nickname: string; isTyping: boolean }) => {
      setTypingUsers((prev) => {
        if (isTyping) {
          if (prev.some((u) => u.id === id)) return prev;
          return [...prev, { id, nickname }];
        } else {
          return prev.filter((u) => u.id !== id);
        }
      });
    });

    // WebRTC: Another peer joined voice. If we are in voice, we initiate the offer
    socket.on("voice:user-joined", ({ id, nickname }: { id: string; nickname: string }) => {
      console.log(`[Socket] Voice user joined: ${nickname} (${id})`);
      if (localStreamRef.current) {
        // We are already in voice, so we initiate peer connection with the newcomer
        createPeerConnection(id, true);
      }
    });

    // WebRTC: Another peer left voice
    socket.on("voice:user-left", ({ id }: { id: string }) => {
      console.log(`[Socket] Voice user left: ${id}`);
      if (peersRef.current.has(id)) {
        peersRef.current.get(id)?.close();
        peersRef.current.delete(id);
      }
      pendingCandidatesRef.current.delete(id);
      stopStream(id);
    });

    // WebRTC: Receive signaling offer, answer or candidate
    socket.on("webrtc:signal", async ({ sender, signal }: { sender: string; signal: any }) => {
      let pc = peersRef.current.get(sender);

      try {
        if (signal.type === "offer") {
          console.log(`[WebRTC] Received offer from ${sender}`);
          pc = createPeerConnection(sender, false);
          await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));

          const queuedCandidates = pendingCandidatesRef.current.get(sender) || [];
          for (const candidate of queuedCandidates) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingCandidatesRef.current.delete(sender);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("webrtc:signal", {
            target: sender,
            signal: { type: "answer", answer: pc.localDescription }
          });
        } else if (signal.type === "answer") {
          console.log(`[WebRTC] Received answer from ${sender}`);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
          }
        } else if (signal.type === "candidate" && signal.candidate) {
          console.log(`[WebRTC] Received ICE candidate from ${sender}`);
          if (pc?.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            const queuedCandidates = pendingCandidatesRef.current.get(sender) || [];
            queuedCandidates.push(signal.candidate);
            pendingCandidatesRef.current.set(sender, queuedCandidates);
          }
        }
      } catch (err) {
        console.error("[WebRTC] Signal handling error:", err);
      }
    });
  };

  // WebRTC Mesh Connection Helper
  const createPeerConnection = (targetUserId: string, isInitiator: boolean) => {
    if (peersRef.current.has(targetUserId)) {
      peersRef.current.get(targetUserId)?.close();
      peersRef.current.delete(targetUserId);
    }

    const pc = new RTCPeerConnection(iceConfiguration);
    peersRef.current.set(targetUserId, pc);

    const applySenderQuality = async (sender: RTCRtpSender) => {
      const qualitySettings = VOICE_QUALITY_SETTINGS[voiceQualityProfileRef.current];

      try {
        const parameters = sender.getParameters();
        parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
        parameters.encodings[0] = {
          ...parameters.encodings[0],
          maxBitrate: qualitySettings.bitrate,
          priority: "high",
          networkPriority: "high",
        };

        if (parameters.codecs) {
          parameters.codecs = parameters.codecs.map((codec) => {
            if (!codec.mimeType.toLowerCase().includes("opus")) return codec;

            const fmtp = [
              codec.sdpFmtpLine,
              `maxaveragebitrate=${qualitySettings.bitrate}`,
              "maxplaybackrate=48000",
              "useinbandfec=1",
              `usedtx=${qualitySettings.dtx ? 1 : 0}`,
            ]
              .filter(Boolean)
              .join(";")
              .replace(/;+/g, ";");

            return {
              ...codec,
              sdpFmtpLine: fmtp,
            };
          });
        }

        await sender.setParameters(parameters);
      } catch (err) {
        console.warn("[WebRTC] Audio sender quality parameters were not applied:", err);
      }
    };

    // Add local mic track
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, localStreamRef.current!);
        if (track.kind === "audio") {
          applySenderQuality(sender);
        }
      });
    }

    // Exchange ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("webrtc:signal", {
          target: targetUserId,
          signal: { type: "candidate", candidate: event.candidate }
        });
      }
    };

    // Receive incoming track
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Remote track received from: ${targetUserId}`);
      const remoteStream = event.streams[0];
      if (remoteStream) {
        playStream(targetUserId, remoteStream);
      }
    };

    const sendOffer = async (iceRestart = false) => {
      if (!socketRef.current) return;

      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, iceRestart });
        await pc.setLocalDescription(offer);
        socketRef.current.emit("webrtc:signal", {
          target: targetUserId,
          signal: { type: "offer", offer: pc.localDescription }
        });
      } catch (err) {
        console.error("[WebRTC] Error creating offer:", err);
      }
    };

    // Connection cleanup logging
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && isInitiator) {
        window.setTimeout(() => {
          if (peersRef.current.get(targetUserId) === pc && pc.connectionState === "failed") {
            sendOffer(true);
          }
        }, 800);
      }

      if (pc.connectionState === "closed") {
        stopStream(targetUserId);
      }
    };

    // If we are initiating the mesh call, generate and send WebRTC offer
    if (isInitiator) {
      sendOffer();
    }

    return pc;
  };

  const requestMicrophoneStream = async (
    micId: string,
    suppressionLevel: NoiseSuppressionLevel,
    qualityProfile: VoiceQualityProfile
  ) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException("Media devices are not supported", "NotFoundError");
    }

    const attempts: MediaStreamConstraints[] = [];

    if (micId) {
      attempts.push(
        {
          audio: getAudioConstraints(micId, suppressionLevel, qualityProfile, "exact"),
          video: false
        },
        {
          audio: { deviceId: { exact: micId } },
          video: false
        },
        {
          audio: getAudioConstraints(micId, suppressionLevel, qualityProfile, "ideal"),
          video: false
        }
      );
    }

    attempts.push(
      {
        audio: getAudioConstraints("", suppressionLevel, qualityProfile),
        video: false
      },
      {
        audio: true,
        video: false
      }
    );

    let lastError: unknown;

    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastError = err;
        const errorName = err instanceof DOMException ? err.name : "";
        if (errorName === "NotAllowedError" || errorName === "SecurityError") {
          throw err;
        }
      }
    }

    throw lastError;
  };

  // Connect Local Microphone Stream and Join Room Voice
  const connectVoice = async (
    micId = selectedMicId,
    suppressionLevel = noiseSuppressionLevel,
    qualityProfile = voiceQualityProfile,
    startMuted = false
  ) => {
    try {
      setVoiceError("");
      const stream = await requestMicrophoneStream(micId, suppressionLevel, qualityProfile);
      const actualMicId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      const actualTrackLabel = stream.getAudioTracks()[0]?.label;
      localStreamRef.current = stream;
      setLocalStream(stream);
      if (actualMicId) {
        setSelectedMicId(actualMicId);
      }
      if (actualTrackLabel) {
        setActiveMicLabel(actualTrackLabel);
      }
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !startMuted;
      });
      setIsMuted(startMuted);
      loadAudioDevices();

      if (socketRef.current) {
        socketRef.current.emit("voice:join");
      }

      playAudioCue("join");
    } catch (err) {
      console.error("Microphone access error:", err);
      setVoiceError(getMicrophoneErrorMessage(err));
    }
  };

  const restartVoiceWithSettings = async (
    micId = selectedMicId,
    suppressionLevel = noiseSuppressionLevel,
    qualityProfile = voiceQualityProfile
  ) => {
    if (!localStreamRef.current) return;

    const wasMuted = isMuted;
    disconnectVoice();
    await connectVoice(micId, suppressionLevel, qualityProfile, wasMuted);
  };

  const handleMicSelection = (micId: string) => {
    stopMicMonitor();
    setSelectedMicId(micId);
    restartVoiceWithSettings(micId, noiseSuppressionLevel, voiceQualityProfile);
  };

  const handleNoiseSuppressionChange = (level: NoiseSuppressionLevel) => {
    stopMicMonitor();
    setNoiseSuppressionLevel(level);
    restartVoiceWithSettings(selectedMicId, level, voiceQualityProfile);
  };

  const handleVoiceQualityChange = (profile: VoiceQualityProfile) => {
    stopMicMonitor();
    setVoiceQualityProfile(profile);
    restartVoiceWithSettings(selectedMicId, noiseSuppressionLevel, profile);
  };

  const closeSettings = () => {
    stopMicMonitor();
    setSettingsOpen(false);
    setNicknameDraft(nickname);
  };

  const saveNickname = () => {
    const cleanNickname = nicknameDraft.trim().replace(/\s+/g, " ").substring(0, 25);
    if (!cleanNickname) return;

    setNickname(cleanNickname);
    setNicknameDraft(cleanNickname);
    setSavedValue(STORAGE_KEYS.nickname, cleanNickname);
    setNicknameSaved(true);
    socketRef.current?.emit("user:nickname", { nickname: cleanNickname });
    window.setTimeout(() => setNicknameSaved(false), 1400);
  };

  const stopMicMonitor = () => {
    if (micMonitorAudioRef.current) {
      micMonitorAudioRef.current.pause();
      micMonitorAudioRef.current.srcObject = null;
      micMonitorAudioRef.current.remove();
      micMonitorAudioRef.current = null;
    }

    if (micMonitorStreamRef.current) {
      micMonitorStreamRef.current.getTracks().forEach((track) => track.stop());
      micMonitorStreamRef.current = null;
    }

    setMicMonitorEnabled(false);
  };

  const toggleMicMonitor = async () => {
    if (micMonitorEnabled) {
      stopMicMonitor();
      return;
    }

    try {
      setMicMonitorError("");
      const stream = await requestMicrophoneStream(selectedMicId, noiseSuppressionLevel, voiceQualityProfile);
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.controls = false;
      audio.style.display = "none";
      audio.srcObject = stream;
      document.body.appendChild(audio);
      await audio.play();

      micMonitorAudioRef.current = audio;
      micMonitorStreamRef.current = stream;
      setMicMonitorEnabled(true);
      const actualMicId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      const actualTrackLabel = stream.getAudioTracks()[0]?.label;
      if (actualMicId) {
        setSelectedMicId(actualMicId);
      }
      if (actualTrackLabel) {
        setActiveMicLabel(actualTrackLabel);
      }
      loadAudioDevices();
    } catch (err) {
      console.error("Microphone monitor error:", err);
      setMicMonitorError(getMicrophoneErrorMessage(err));
      stopMicMonitor();
    }
  };

  // Mute / Unmute Local Microphone Stream
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  // Disconnect from WebRTC Voice Channel
  const disconnectVoice = () => {
    if (socketRef.current) {
      socketRef.current.emit("voice:leave");
    }

    // Stop microphone tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setIsMuted(false);
    setVoiceError("");
    setActiveMicLabel("");

    // Close and remove all Peer Connections
    peersRef.current.forEach((pc, userId) => {
      pc.close();
      stopStream(userId);
    });
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();

    playAudioCue("leave");
  };

  // Send Text Message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !socketRef.current) return;

    socketRef.current.emit("chat:message", { text: inputText });
    setInputText("");

    // Reset typing timeout immediately
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socketRef.current.emit("chat:typing", { isTyping: false });
  };

  // Typing state emission throttled
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    if (!socketRef.current) return;

    // Notify typing
    socketRef.current.emit("chat:typing", { isTyping: true });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("chat:typing", { isTyping: false });
    }, 2500);
  };

  // Logout/Reset User
  const handleLogout = () => {
    disconnectVoice();
    stopMicMonitor();
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    setJoined(false);
    setUsers([]);
    setMessages([]);
    setTypingUsers([]);
    setJoinError("");
    setIsJoining(false);
  };

  // Filter lists
  const voiceConnectedUsers = users.filter((u) => u.inVoice);
  const textOnlineUsers = users.filter((u) => !u.inVoice);

  if (!joined) {
    return (
      <div id="login-container" className="min-h-screen bg-[#0a0a0b] flex flex-col items-center justify-center p-4 font-sans text-[#e1e1e6] overflow-hidden relative">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-sm bg-[#0f0f11] border border-[#1a1a1c] rounded-xl p-7 shadow-2xl relative z-10"
        >
          <div className="flex flex-col items-center mb-7">
            <div className="h-14 w-14 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-950/45 mb-4 ring-1 ring-white/10">
              <MessageCircle className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight font-display text-white mb-1">
              SpeakWise
            </h1>
            <p className="text-xs text-gray-500 font-medium text-center">
              Tek oda, yazılı sohbet ve sesli konuşma.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#1a1a1c] bg-[#050506] px-3 py-2">
              <div className="w-6 h-6 bg-indigo-600/20 text-indigo-300 rounded-full flex items-center justify-center text-xs font-semibold ring-1 ring-indigo-500/30">
                {nickname.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs font-medium text-gray-300">{nickname || "Misafir"}</span>
            </div>
          </div>

          <form onSubmit={handleJoin} className="space-y-5">
            {roomKeyRequired && (
              <div>
                <label htmlFor="room-key-input" className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                  Oda Anahtarı
                </label>
                <input
                  id="room-key-input"
                  type="password"
                  required
                  value={roomKey}
                  onChange={(e) => setRoomKey(e.target.value)}
                  className="w-full px-4 py-3 bg-[#050506] border border-[#1a1a1c] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-white placeholder-gray-700 transition font-medium text-sm"
                  placeholder="Arkadaş grubunun oda anahtarı"
                />
              </div>
            )}

            {joinError && (
              <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs font-medium text-red-300">
                {joinError}
              </div>
            )}

            <button
              id="login-submit"
              type="submit"
              disabled={isJoining || !configLoaded}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:pointer-events-none text-white font-semibold rounded-xl shadow-lg shadow-indigo-600/15 transition active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer border border-indigo-500/30"
            >
              <Smile className="h-5 w-5" />
              {!configLoaded ? "Hazırlanıyor..." : isJoining ? "Bağlanıyor..." : roomKeyRequired ? "Odaya Gir" : "Bağlanıyor..."}
            </button>
          </form>

          <p className="mt-5 text-center text-[11px] text-gray-600">
            Kullanıcı adı otomatik atanır. İçeride ayarlardan mikrofonunu seçebilirsin.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0a0a0b] flex text-[#e1e1e6] font-sans overflow-hidden select-none">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="h-14 bg-[#0f0f11] border-b border-[#1a1a1c] px-4 flex items-center justify-between z-10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-indigo-600 rounded-lg flex items-center justify-center border border-indigo-500/30 shadow">
              <MessageCircle className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-display text-white tracking-wide uppercase">
                SpeakWise
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                <span className="text-[9px] text-emerald-400 font-bold tracking-wider uppercase">Canlı Sunucu</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#1a1a1c] px-3 py-1.5 rounded-lg border border-white/5">
              <div className="w-5 h-5 bg-indigo-600/20 text-indigo-300 rounded-full flex items-center justify-center text-xs font-semibold ring-1 ring-indigo-500/30">
                {nickname.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs font-medium text-gray-300 truncate max-w-[120px]">
                {nickname}
              </span>
            </div>

            <button
              id="settings-button"
              onClick={() => {
                setSettingsOpen(true);
                loadAudioDevices();
              }}
              title="Ayarlar"
              className="p-2 bg-[#1a1a1c] hover:bg-[#252528] text-gray-400 hover:text-white rounded-lg transition active:scale-95 cursor-pointer border border-[#1a1a1c] hover:border-white/10"
            >
              <Settings className="h-4 w-4" />
            </button>

            <button
              id="logout-button"
              onClick={handleLogout}
              title="Oturumu Kapat"
              className="p-2 bg-[#1a1a1c] hover:bg-red-950/40 text-gray-400 hover:text-red-400 rounded-lg transition active:scale-95 cursor-pointer border border-[#1a1a1c] hover:border-red-900/30"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Main Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar */}
          <aside className="w-60 bg-[#0f0f11] border-r border-[#1a1a1c] flex flex-col justify-between flex-shrink-0">
            {/* Channel list and Users */}
            <div className="flex-1 overflow-y-auto p-3 space-y-6">
              {/* Rooms / Channels Section */}
              <div className="space-y-1">
                <span className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-2 mb-2">YAZI KANALLARI</span>
                <div className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold bg-[#1a1a1c] text-white border border-white/5">
                  <span className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-gray-500" />
                    genel
                  </span>
                  <span className="text-[10px] bg-indigo-950/40 text-indigo-400 px-1.5 py-0.5 rounded font-mono border border-indigo-900/30">aktif</span>
                </div>
              </div>

              {/* Voice Room Status & Controls */}
              <div className="space-y-3 bg-[#0a0a0b] p-3 rounded-xl border border-[#1a1a1c] shadow-inner">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">SES ODASI</span>
                  {localStream ? (
                    <span className="text-[9px] bg-emerald-950/40 text-emerald-400 font-bold px-1.5 py-0.5 rounded flex items-center gap-1 border border-emerald-900/30">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                      </span>
                      BAĞLI
                    </span>
                  ) : (
                    <span className="text-[9px] bg-[#1a1a1c] text-gray-500 font-bold px-1.5 py-0.5 rounded">BOŞTA</span>
                  )}
                </div>

                {localStream ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5 p-2 bg-[#1a1a1c] rounded-lg border border-white/5">
                      <div className={`p-2 rounded-full ${isTalking ? "bg-emerald-500 text-slate-950 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-indigo-600/15 text-indigo-400"}`}>
                        {isMuted ? <MicOff className="h-4 w-4 text-red-400" /> : <Mic className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <div className="text-xs font-semibold text-white truncate">Sesteyim</div>
                        <div className="text-[10px] text-gray-400 flex items-center gap-1 truncate">
                          {isMuted ? "Susturuldu" : isTalking ? "Konuşuyor..." : "Mikrofon Açık"}
                          {isTalking && !isMuted && (
                            <span className="flex items-end h-3 pl-1">
                              <span className="wave-bar"></span>
                              <span className="wave-bar"></span>
                              <span className="wave-bar"></span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        id="voice-mute-button"
                        onClick={toggleMute}
                        className={`py-2 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          isMuted 
                            ? "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20" 
                            : "bg-[#1a1a1c] text-gray-300 hover:bg-[#252528] border border-white/5"
                        }`}
                      >
                        {isMuted ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
                        {isMuted ? "Aç" : "Sustur"}
                      </button>
                      <button
                        id="voice-disconnect-button"
                        onClick={disconnectVoice}
                        className="py-2 bg-red-600/20 text-red-500 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1 cursor-pointer border border-red-900/30 hover:bg-red-600/30"
                      >
                        <VolumeX className="h-3 w-3" />
                        Ayrıl
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    id="voice-connect-button"
                    onClick={() => connectVoice()}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded transition flex items-center justify-center gap-1.5 shadow-md shadow-indigo-950/20 active:scale-[0.98] cursor-pointer border border-indigo-500/30"
                  >
                    <Volume2 className="h-4 w-4" />
                    Sese Bağlan
                  </button>
                )}

                {voiceError && (
                  <div className="rounded-lg border border-red-900/35 bg-red-950/15 px-3 py-2 text-[11px] font-medium leading-relaxed text-red-300">
                    {voiceError}
                  </div>
                )}
              </div>

              {/* Online Voice Users */}
              <div className="space-y-2">
                <div className="flex items-center justify-between pl-1">
                  <span className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest">Sestekiler ({voiceConnectedUsers.length})</span>
                  {voiceConnectedUsers.length > 0 && <span className="text-[10px] text-emerald-400">● Aktif</span>}
                </div>
                <div className="space-y-1.5">
                  {voiceConnectedUsers.length === 0 ? (
                    <p className="text-[11px] text-gray-600 italic pl-1">Ses kanalında kimse yok.</p>
                  ) : (
                    voiceConnectedUsers.map((user) => (
                      <div 
                        key={user.id} 
                        className={`flex items-center justify-between p-2 rounded text-xs bg-[#1a1a1c] border transition ${
                          user.id === socketRef.current?.id 
                            ? "border-indigo-500/30 bg-indigo-950/10" 
                            : "border-white/5"
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <div className="relative">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-[10px] font-bold text-white uppercase">
                              {user.nickname.charAt(0)}
                            </div>
                            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-[#0f0f11]"></span>
                          </div>
                          <span className="text-gray-200 font-medium truncate">{user.nickname}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {user.id === socketRef.current?.id && isTalking && !isMuted ? (
                            <div className="flex items-end h-3 pl-1 pr-1">
                              <span className="wave-bar"></span>
                              <span className="wave-bar"></span>
                              <span className="wave-bar"></span>
                            </div>
                          ) : (
                            <Mic className="h-3.5 w-3.5 text-emerald-400" />
                          )}
                          {user.id === socketRef.current?.id && <Crown className="h-3 w-3 text-amber-400" />}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Online Members */}
              <div className="space-y-2">
                <span className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">ÇEVRİMİÇİ ÜYELER ({textOnlineUsers.length})</span>
                <div className="space-y-1">
                  {textOnlineUsers.length === 0 ? (
                    <p className="text-[11px] text-gray-600 italic pl-1">Oda boş veya herkes ses kanalında.</p>
                  ) : (
                    textOnlineUsers.map((user) => (
                      <div key={user.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-transparent transition group">
                        <div className="flex items-center gap-2.5 truncate">
                          <div className="relative">
                            <div className="w-7 h-7 bg-[#1a1a1c] text-gray-300 rounded-full flex items-center justify-center text-xs font-bold uppercase border border-white/5">
                              {user.nickname.charAt(0)}
                            </div>
                            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-[#475569] ring-1 ring-[#0f0f11]"></span>
                          </div>
                          <span className="text-gray-400 group-hover:text-white transition-colors text-sm truncate">{user.nickname}</span>
                        </div>
                        {user.isTyping && (
                          <span className="text-[9px] bg-indigo-950/30 text-indigo-400 px-1 py-0.5 rounded animate-pulse border border-indigo-900/20">
                            yazıyor
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Connection status footer */}
            <div className="p-3 border-t border-[#1a1a1c] bg-[#09090a] flex items-center justify-between">
              <div className="flex items-center gap-2 truncate">
                <div className="h-1.5 w-1.5 rounded-full bg-indigo-500"></div>
                <span className="text-[10px] font-mono text-gray-500 truncate">id: {socketRef.current?.id?.substring(0, 8)}</span>
              </div>
              <span className="text-[8px] bg-indigo-950/40 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-900/30 font-semibold tracking-wider font-mono">
                NET_WS
              </span>
            </div>
          </aside>

          {/* Right Chat Panel */}
          <section className="flex-1 bg-[#141417] flex flex-col overflow-hidden relative">
            {/* Main Channel Header */}
            <div className="h-14 bg-[#141417]/80 backdrop-blur-md border-b border-[#1a1a1c] px-6 flex items-center justify-between flex-shrink-0 z-10">
              <div className="flex items-center">
                <span className="text-gray-500 text-xl font-light mr-2">#</span>
                <h2 className="font-bold text-sm text-white tracking-wide">general-chat</h2>
                <div className="ml-4 w-[1px] h-6 bg-[#1a1a1c]"></div>
                <p className="ml-4 text-xs text-gray-500 italic hidden sm:inline">Burası arkadaşlarınla sohbet edebileceğin ana kanal.</p>
              </div>
              
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Users className="h-4 w-4 text-gray-500" />
                <span className="font-medium text-gray-500">{users.length} çevrimiçi</span>
              </div>
            </div>

            {/* Chat Messages Log */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 max-w-md mx-auto">
                  <div className="h-14 w-14 bg-indigo-500/5 rounded-full flex items-center justify-center mb-4 text-indigo-400 border border-indigo-500/10">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <h3 className="text-sm font-bold text-white">Sohbetin Başlangıcı</h3>
                  <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                    Burası genel kanalının ilk mesaj geçmişidir. Arkadaşlarından birinin odaya katılmasını bekle ya da ilk mesajı sen yazarak sohbeti başlat!
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* welcome alert matching Elegant Dark */}
                  <div className="bg-[#1a1a1c] border border-white/5 p-4 rounded-xl text-xs text-gray-400 flex items-start gap-3 shadow-sm">
                    <span className="text-indigo-400">⚡</span>
                    <div>
                      <span className="font-semibold text-white">Sesli Sohbet:</span> Arkadaşlarınızla sesli konuşabilmek için sol taraftaki <span className="text-emerald-400 font-bold">"Sese Bağlan"</span> butonuna tıklamanız ve mikrofon izinlerini onaylamanız yeterlidir.
                    </div>
                  </div>

                  {messages.map((msg, index) => {
                    const isOwn = msg.senderId === socketRef.current?.id;
                    
                    return (
                      <motion.div 
                        key={msg.id || index}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className={`flex space-x-4 ${isOwn ? "bg-indigo-500/5 p-3 rounded-lg border-l-4 border-indigo-500" : ""}`}
                      >
                        {/* Avatar */}
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 shadow-sm ${
                          isOwn 
                            ? "bg-indigo-600 text-white" 
                            : "bg-[#1a1a1c] text-gray-300 border border-white/5"
                        }`}>
                          {msg.senderNickname.charAt(0).toUpperCase()}
                        </div>

                        {/* Content block */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="font-bold text-sm text-white">
                              {msg.senderNickname}
                            </span>
                            <span className="text-[10px] text-gray-500 font-mono">
                              {msg.timestamp}
                            </span>
                          </div>
                          
                          <p className="text-sm text-gray-300 leading-relaxed break-words">
                            {msg.text}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Inputs & Typing status overlay */}
            <div className="px-6 pb-8 pt-2">
              {/* Typing status bar */}
              <div className="h-5 flex items-center px-1 mb-1.5">
                <AnimatePresence>
                  {typingUsers.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="text-xs text-gray-500 italic font-medium flex items-center space-x-2"
                    >
                      <div className="flex space-x-1">
                        <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"></div>
                        <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                        <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                      </div>
                      <span>
                        {typingUsers.map((u) => u.nickname).join(", ")} {typingUsers.length === 1 ? "yazıyor..." : "yazıyorlar..."}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Input Bar Form with Elegant Dark style */}
              <form onSubmit={handleSendMessage} className="relative flex items-center bg-[#1a1a1c] rounded-xl px-4 py-3 border border-white/5 focus-within:border-indigo-500 transition-colors">
                <button type="button" className="text-gray-400 hover:text-white mr-3 text-lg font-light">⊕</button>
                <input
                  id="chat-input"
                  type="text"
                  value={inputText}
                  onChange={handleInputChange}
                  maxLength={1000}
                  placeholder={`#general-chat kanalına mesaj gönder...`}
                  className="bg-transparent w-full text-sm outline-none placeholder:text-gray-600 text-white"
                />
                <button
                  id="chat-send-submit"
                  type="submit"
                  disabled={!inputText.trim()}
                  className="ml-2 text-indigo-400 hover:text-indigo-300 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>

      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.16 }}
              className="max-h-[92vh] w-full max-w-md overflow-hidden rounded-xl border border-[#1f1f23] bg-[#0f0f11] shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-[#1a1a1c] px-5 py-4">
                <div>
                  <h3 className="text-sm font-bold text-white">Ayarlar</h3>
                  <p className="text-xs text-gray-500">Profil, mikrofon ve bildirimler</p>
                </div>
                <button
                  type="button"
                  onClick={closeSettings}
                  title="Kapat"
                  className="rounded-lg border border-[#1a1a1c] bg-[#1a1a1c] p-2 text-gray-400 transition hover:border-white/10 hover:bg-[#252528] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[calc(92vh-73px)] space-y-5 overflow-y-auto p-5">
                <div>
                  <label htmlFor="nickname-settings-input" className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    Kullanıcı Adı
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="nickname-settings-input"
                      type="text"
                      maxLength={25}
                      value={nicknameDraft}
                      onChange={(event) => {
                        setNicknameDraft(event.target.value);
                        setNicknameSaved(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveNickname();
                        }
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-[#1a1a1c] bg-[#050506] px-3 py-2.5 text-sm font-medium text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                      placeholder="Kullanıcı adın"
                    />
                    <button
                      type="button"
                      onClick={saveNickname}
                      disabled={!nicknameDraft.trim()}
                      className="rounded-lg border border-indigo-500/30 bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-50"
                    >
                      Kaydet
                    </button>
                  </div>
                  <p className={`mt-2 text-[11px] ${nicknameSaved ? "text-emerald-400" : "text-gray-600"}`}>
                    {nicknameSaved ? "Kaydedildi. Sayfayı yenilesen de kalır." : "Bu isim bu tarayıcıda saklanır."}
                  </p>
                </div>

                <div>
                  <label htmlFor="microphone-select" className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    Mikrofon
                  </label>
                  <select
                    id="microphone-select"
                    value={selectedMicId}
                    onChange={(event) => handleMicSelection(event.target.value)}
                    className="w-full rounded-lg border border-[#1a1a1c] bg-[#050506] px-3 py-2.5 text-sm font-medium text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                  >
                    {audioDevices.length === 0 ? (
                      <option value="">Varsayılan mikrofon</option>
                    ) : (
                      audioDevices.map((device, index) => (
                        <option key={device.deviceId || index} value={device.deviceId}>
                          {device.label || `Mikrofon ${index + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                  <p className="mt-2 text-[11px] text-gray-600">
                    Aktif: {activeMicLabel || "Henüz mikrofon açılmadı"}
                  </p>
                </div>

                <div className="rounded-lg border border-[#1a1a1c] bg-[#0a0a0b] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-gray-300">Mikrofon testi</div>
                      <div className="mt-1 text-[11px] text-gray-600">Kendi sesini kısa süreli dinleyebilirsin.</div>
                    </div>
                    <button
                      type="button"
                      onClick={toggleMicMonitor}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                        micMonitorEnabled
                          ? "border border-red-900/40 bg-red-950/30 text-red-300 hover:bg-red-950/50"
                          : "border border-emerald-900/30 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/35"
                      }`}
                    >
                      {micMonitorEnabled ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {micMonitorEnabled ? "Durdur" : "Dinle"}
                    </button>
                  </div>
                  {micMonitorEnabled && (
                    <div className="mt-3 rounded-md border border-amber-900/30 bg-amber-950/15 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300">
                      Hoparlörden yankı yaparsa testi durdur veya kulaklık kullan.
                    </div>
                  )}
                  {micMonitorError && (
                    <div className="mt-3 rounded-md border border-red-900/35 bg-red-950/15 px-2.5 py-2 text-[11px] leading-relaxed text-red-300">
                      {micMonitorError}
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      Gürültü Önleme
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                      {noiseSuppressionLevel === "off"
                        ? "Kapalı"
                        : noiseSuppressionLevel === "low"
                          ? "Az"
                          : noiseSuppressionLevel === "medium"
                            ? "Orta"
                            : "Çok"}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-1 rounded-lg border border-[#1a1a1c] bg-[#050506] p-1">
                    {([
                      ["off", "Kapalı"],
                      ["low", "Az"],
                      ["medium", "Orta"],
                      ["high", "Çok"],
                    ] as const).map(([level, label]) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => handleNoiseSuppressionChange(level)}
                        className={`rounded-md px-2 py-2 text-xs font-semibold transition ${
                          noiseSuppressionLevel === level
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-gray-400 hover:bg-[#1a1a1c] hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-600">
                    Ses kesiliyorsa Az ya da Orta kullan. Çok modu dip sesi azaltır ama bazı mikrofonlarda konuşmayı kırpabilir.
                  </p>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      Ses Kalitesi
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                      {VOICE_QUALITY_SETTINGS[voiceQualityProfile].label}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#1a1a1c] bg-[#050506] p-1">
                    {([
                      ["stable", "Stabil"],
                      ["balanced", "Dengeli"],
                      ["quality", "Kaliteli"],
                    ] as const).map(([profile, label]) => (
                      <button
                        key={profile}
                        type="button"
                        onClick={() => handleVoiceQualityChange(profile)}
                        className={`rounded-md px-2 py-2 text-xs font-semibold transition ${
                          voiceQualityProfile === profile
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-gray-400 hover:bg-[#1a1a1c] hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-600">
                    Kaliteli mod daha net ses verir. Stabil mod zayıf bağlantıda daha kontrollü bant genişliği kullanır.
                  </p>
                </div>

                <div className="rounded-lg border border-[#1a1a1c] bg-[#0a0a0b] px-3 py-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-300">Echo engelleme</span>
                    <span className={noiseSuppressionLevel === "off" ? "text-gray-500" : "text-emerald-400"}>
                      {noiseSuppressionLevel === "off" ? "Kapalı" : "Açık"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-300">Gürültü filtreleme</span>
                    <span className={noiseSuppressionLevel === "medium" || noiseSuppressionLevel === "high" ? "text-emerald-400" : "text-gray-500"}>
                      {noiseSuppressionLevel === "medium" || noiseSuppressionLevel === "high" ? "Açık" : "Kapalı"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-300">Otomatik ses dengesi</span>
                    <span className={noiseSuppressionLevel === "high" ? "text-emerald-400" : "text-gray-500"}>
                      {noiseSuppressionLevel === "high" ? "Açık" : "Kapalı"}
                    </span>
                  </div>
                </div>

                <div className="rounded-lg border border-[#1a1a1c] bg-[#0a0a0b] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <Bell className="mt-0.5 h-4 w-4 text-indigo-400" />
                      <div>
                        <div className="text-xs font-semibold text-gray-300">Mesaj sesi</div>
                        <div className="mt-1 text-[11px] leading-relaxed text-gray-600">
                          OS bildirimi açmaz; alttab yaptırmadan sadece kısa ses çalar.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotificationSoundEnabled((enabled) => !enabled)}
                      className={`h-6 w-11 rounded-full p-0.5 transition ${
                        notificationSoundEnabled ? "bg-indigo-600" : "bg-[#252528]"
                      }`}
                      aria-pressed={notificationSoundEnabled}
                    >
                      <span
                        className={`block h-5 w-5 rounded-full bg-white transition ${
                          notificationSoundEnabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {localStream && (
                  <div className="rounded-lg border border-emerald-900/30 bg-emerald-950/10 px-3 py-2 text-xs font-medium text-emerald-300">
                    Ses bağlıyken değişiklikler otomatik yeniden bağlanarak uygulanır.
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
