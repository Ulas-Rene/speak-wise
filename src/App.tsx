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
  User, 
  Volume2, 
  VolumeX, 
  Radio, 
  Smile, 
  Sparkles,
  Crown,
  Settings,
  X
} from "lucide-react";
import { User as UserType, Message } from "./types";

type NoiseSuppressionLevel = "off" | "low" | "medium" | "high";

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
  noiseSuppressionLevel: NoiseSuppressionLevel
): MediaTrackConstraints => {
  const processingEnabled = noiseSuppressionLevel !== "off";

  return {
    deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
    echoCancellation: processingEnabled,
    noiseSuppression: processingEnabled,
    autoGainControl: noiseSuppressionLevel === "medium" || noiseSuppressionLevel === "high",
    channelCount: 1,
  };
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
    audio.style.display = "none";
    document.body.appendChild(audio);
  }
  audio.srcObject = stream;
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
  const [activeChannel, setActiveChannel] = useState("genel");
  const [isTalking, setIsTalking] = useState(false); // local voice volume activity detector
  const [roomKey, setRoomKey] = useState("");
  const [roomKeyRequired, setRoomKeyRequired] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [noiseSuppressionLevel, setNoiseSuppressionLevel] = useState<NoiseSuppressionLevel>("medium");

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Generate random default nickname
  useEffect(() => {
    const randomPick = RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)];
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    setNickname(`${randomPick}#${randomNum}`);
  }, []);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then((config) => setRoomKeyRequired(Boolean(config.roomKeyRequired)))
      .catch(() => setRoomKeyRequired(false));
  }, []);

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
      stopStream(id);
    });

    socket.on("user:updated", (updatedUser: UserType) => {
      setUsers((prev) => prev.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
    });

    // Handle incoming text message
    socket.on("chat:message", (newMessage: Message) => {
      setMessages((prev) => [...prev, newMessage]);
      if (newMessage.senderId !== socket.id) {
        playAudioCue("msg");
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
      stopStream(id);
    });

    // WebRTC: Receive signaling offer, answer or candidate
    socket.on("webrtc:signal", ({ sender, signal }: { sender: string; signal: any }) => {
      let pc = peersRef.current.get(sender);

      if (signal.type === "offer") {
        console.log(`[WebRTC] Received offer from ${sender}`);
        pc = createPeerConnection(sender, false);
        pc.setRemoteDescription(new RTCSessionDescription(signal.offer))
          .then(() => pc!.createAnswer())
          .then((answer) => pc!.setLocalDescription(answer))
          .then(() => {
            socket.emit("webrtc:signal", {
              target: sender,
              signal: { type: "answer", answer: pc!.localDescription }
            });
          })
          .catch((err) => console.error("[WebRTC] Error handling offer:", err));
      } else if (signal.type === "answer") {
        console.log(`[WebRTC] Received answer from ${sender}`);
        if (pc) {
          pc.setRemoteDescription(new RTCSessionDescription(signal.answer))
            .catch((err) => console.error("[WebRTC] Error setting remote answer:", err));
        }
      } else if (signal.type === "candidate") {
        console.log(`[WebRTC] Received ICE candidate from ${sender}`);
        if (pc && signal.candidate) {
          pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
            .catch((err) => console.error("[WebRTC] Error adding ICE candidate:", err));
        }
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

    // Add local mic track
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
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

    // Connection cleanup logging
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
        stopStream(targetUserId);
      }
    };

    // If we are initiating the mesh call, generate and send WebRTC offer
    if (isInitiator) {
      pc.createOffer({ offerToReceiveAudio: true })
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          if (socketRef.current) {
            socketRef.current.emit("webrtc:signal", {
              target: targetUserId,
              signal: { type: "offer", offer: pc.localDescription }
            });
          }
        })
        .catch((err) => console.error("[WebRTC] Error creating offer:", err));
    }

    return pc;
  };

  // Connect Local Microphone Stream and Join Room Voice
  const connectVoice = async (
    micId = selectedMicId,
    suppressionLevel = noiseSuppressionLevel,
    startMuted = false
  ) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: getAudioConstraints(micId, suppressionLevel),
        video: false
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !startMuted;
      });
      setIsMuted(startMuted);
      loadAudioDevices();

      if (socketRef.current) {
        socketRef.current.emit("voice:join");
      }

      playAudioCue("join");

      // For every other online user currently in voice channel, initiate a WebRTC call
      users.forEach((otherUser) => {
        if (otherUser.inVoice && otherUser.id !== socketRef.current?.id) {
          createPeerConnection(otherUser.id, true);
        }
      });
    } catch (err) {
      console.error("Microphone access error:", err);
      alert("Mikrofona erişilemedi! Lütfen izinlerinizi kontrol edin.");
    }
  };

  const restartVoiceWithSettings = async (
    micId = selectedMicId,
    suppressionLevel = noiseSuppressionLevel
  ) => {
    if (!localStreamRef.current) return;

    const wasMuted = isMuted;
    disconnectVoice();
    await connectVoice(micId, suppressionLevel, wasMuted);
  };

  const handleMicSelection = (micId: string) => {
    setSelectedMicId(micId);
    restartVoiceWithSettings(micId, noiseSuppressionLevel);
  };

  const handleNoiseSuppressionChange = (level: NoiseSuppressionLevel) => {
    setNoiseSuppressionLevel(level);
    restartVoiceWithSettings(selectedMicId, level);
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

    // Close and remove all Peer Connections
    peersRef.current.forEach((pc, userId) => {
      pc.close();
      stopStream(userId);
    });
    peersRef.current.clear();

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
        {/* Glow visual backdrops matching Elegant Dark */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full filter blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full filter blur-[120px] pointer-events-none" />

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-md bg-[#0f0f11] border border-[#1a1a1c] rounded-2xl p-8 shadow-2xl relative z-10"
        >
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="h-16 w-16 bg-gradient-to-tr from-indigo-600 via-purple-600 to-indigo-800 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-950/45 mb-4 ring-1 ring-white/10">
              <Radio className="h-8 w-8 text-white animate-pulse" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight font-display text-white mb-1">
              Sohbet & Sesli Chat
            </h1>
            <p className="text-xs text-gray-500 font-medium">
              Eşzamanlı Mesajlaşma ve Bas-Konuş WebRTC Oda Altyapısı
            </p>
          </div>

          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label htmlFor="nickname-input" className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                Kullanıcı Adınız (Nickname)
              </label>
              <div className="relative">
                <input
                  id="nickname-input"
                  type="text"
                  required
                  maxLength={25}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full px-4 py-3 bg-[#050506] border border-[#1a1a1c] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-white placeholder-gray-700 transition font-medium text-sm"
                  placeholder="Kullanıcı adınızı yazın..."
                />
                <div className="absolute right-3 top-3.5 flex items-center gap-1 text-xs text-indigo-400">
                  <Sparkles className="h-4 w-4" />
                </div>
              </div>
            </div>

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
              disabled={isJoining}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:pointer-events-none text-white font-semibold rounded-xl shadow-lg shadow-indigo-600/15 transition active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer border border-indigo-500/30"
            >
              <Smile className="h-5 w-5" />
              {isJoining ? "Bağlanıyor..." : "Odaya Bağlan"}
            </button>
          </form>

          <div className="mt-8 border-t border-[#1a1a1c] pt-4 flex justify-between items-center text-xs text-gray-600">
            <span>🚀 Mesh WebRTC P2P Voice</span>
            <span>⚡ Real-time Websocket</span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0a0a0b] flex text-[#e1e1e6] font-sans overflow-hidden select-none">
      {/* Server Navigation Rail (As seen in Elegant Dark theme spec) */}
      <nav className="w-[72px] bg-[#050506] flex flex-col items-center py-4 space-y-3 border-r border-[#1a1a1c] flex-shrink-0">
        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-bold cursor-pointer hover:rounded-xl transition-all shadow-md shadow-indigo-900/35 relative group">
          <span className="font-display text-lg">G</span>
          <div className="absolute left-0 top-3 w-1 h-6 bg-white rounded-r-lg group-hover:h-8 transition-all"></div>
        </div>
        <div className="w-8 h-[2px] bg-[#1a1a1c] rounded-full"></div>
        <div className="w-12 h-12 bg-[#1a1a1c] rounded-3xl flex items-center justify-center text-gray-400 hover:bg-indigo-600 hover:text-white cursor-pointer transition-all hover:rounded-2xl">
          <span className="text-xs font-semibold">TR</span>
        </div>
        <div className="w-12 h-12 bg-[#1a1a1c] rounded-3xl flex items-center justify-center text-emerald-500 hover:bg-emerald-600 hover:text-white cursor-pointer transition-all hover:rounded-2xl">
          <span className="text-lg font-bold">+</span>
        </div>
      </nav>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="h-14 bg-[#0f0f11] border-b border-[#1a1a1c] px-4 flex items-center justify-between z-10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-[#1a1a1c] rounded-lg flex items-center justify-center border border-white/5 shadow">
              <Radio className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-display text-white tracking-wide uppercase">
                Sohbet & Sesli Chat
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

          {/* User profile & exit */}
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
                <button
                  onClick={() => setActiveChannel("genel")}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition ${
                    activeChannel === "genel"
                      ? "bg-[#1a1a1c] text-white border border-white/5"
                      : "text-gray-400 hover:bg-[#1a1a1c]/50 hover:text-white"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-gray-500" />
                    genel
                  </span>
                  <span className="text-[10px] bg-indigo-950/40 text-indigo-400 px-1.5 py-0.5 rounded font-mono border border-indigo-900/30">aktif</span>
                </button>
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
                    onClick={connectVoice}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded transition flex items-center justify-center gap-1.5 shadow-md shadow-indigo-950/20 active:scale-[0.98] cursor-pointer border border-indigo-500/30"
                  >
                    <Volume2 className="h-4 w-4" />
                    Sese Bağlan
                  </button>
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
                      <div key={user.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#1a1a1c] transition cursor-pointer group">
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
              className="w-full max-w-md rounded-xl border border-[#1f1f23] bg-[#0f0f11] shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-[#1a1a1c] px-5 py-4">
                <div>
                  <h3 className="text-sm font-bold text-white">Ayarlar</h3>
                  <p className="text-xs text-gray-500">Mikrofon ve ses işleme</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  title="Kapat"
                  className="rounded-lg border border-[#1a1a1c] bg-[#1a1a1c] p-2 text-gray-400 transition hover:border-white/10 hover:bg-[#252528] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-5 p-5">
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
                </div>

                <div className="rounded-lg border border-[#1a1a1c] bg-[#0a0a0b] px-3 py-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-300">Echo engelleme</span>
                    <span className={noiseSuppressionLevel === "off" ? "text-gray-500" : "text-emerald-400"}>
                      {noiseSuppressionLevel === "off" ? "Kapalı" : "Açık"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-300">Otomatik ses dengesi</span>
                    <span className={noiseSuppressionLevel === "medium" || noiseSuppressionLevel === "high" ? "text-emerald-400" : "text-gray-500"}>
                      {noiseSuppressionLevel === "medium" || noiseSuppressionLevel === "high" ? "Açık" : "Kapalı"}
                    </span>
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
