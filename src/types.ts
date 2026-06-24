export interface User {
  id: string;
  nickname: string;
  inVoice: boolean;
  isTyping: boolean;
}

export interface Message {
  id: string;
  senderId: string;
  senderNickname: string;
  text: string;
  timestamp: string;
}

export interface SignalData {
  sender: string;
  signal: any;
}
