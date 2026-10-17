import { FC, useState, useEffect, memo, useRef } from 'react';
import { MessageSquare, Search, Send, ShieldAlert, ShieldCheck, ArrowLeft, Plus, Headphones } from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { User, Conversation, Message } from '../types';

interface Props {
  currentUser: User;
  initialPeerId?: string | null;
  targetPeerId?: string | null;
}

const MessageItem = memo(({ m, isMe, isAdmin }: { m: Message; isMe: boolean; isAdmin: boolean }) => (
  <div
    className={`flex flex-col max-w-[80%] rounded-2xl p-3 text-xs leading-relaxed ${
      isMe
        ? 'ml-auto bg-amber-500 text-zinc-950 font-medium rounded-br-none shadow-md shadow-amber-500/10'
        : isAdmin
        ? 'mr-auto bg-sky-950/80 border border-sky-500/30 text-sky-100 rounded-bl-none'
        : 'mr-auto bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-bl-none'
    }`}
  >
    {!isMe && (
      <span className={`text-[10px] font-mono font-bold mb-1 flex items-center gap-1 ${
        isAdmin ? 'text-sky-400' : 'text-zinc-400'
      }`}>
        {isAdmin && <ShieldCheck className="w-3 h-3" />}
        {isAdmin ? 'Official Support' : `User #${m.senderId}`}
      </span>
    )}
    <p className="break-words">{m.text}</p>
    <span className={`text-[9px] font-mono mt-1 self-end ${
      isMe ? 'text-zinc-900/70' : 'text-zinc-500'
    }`}>
      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  </div>
));

export const MessengerView: FC<Props> = ({ currentUser, initialPeerId, targetPeerId }) => {
  const [conversations, setConversations] = useState<Conversation[]>(() => BoostPayStore.getConversations());
  const [messages, setMessages] = useState<Message[]>(() => BoostPayStore.getMessages());
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputMsg, setInputMsg] = useState('');
  const [isSending, setIsSending] = useState(false);

  // New Chat Dialog
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newPeerId, setNewPeerId] = useState('');
  const [newChatError, setNewChatError] = useState('');

  // Auto-scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const peerIdToUse = initialPeerId || targetPeerId;

  // Real-time Server-Sent Events (SSE) Stream + Initial Sync
  useEffect(() => {
    // 1. Initial lightweight sync of user's conversations and messages
    BoostPayStore.syncChatState(currentUser.id);

    // 2. Real-time SSE push connection
    const unsubscribeStream = BoostPayStore.initChatStream(currentUser.id);

    // 3. Subscription to local state updates
    const unsubscribeLocal = BoostPayStore.subscribeToChat((convs, msgs) => {
      setConversations(convs);
      setMessages(msgs);
    });

    return () => {
      unsubscribeStream();
      unsubscribeLocal();
    };
  }, [currentUser.id]);

  // Keep activeConv synchronized with latest conversation state
  useEffect(() => {
    if (activeConv) {
      const fresh = conversations.find(c => c.id === activeConv.id);
      if (fresh && (fresh.lastMessageAt !== activeConv.lastMessageAt || fresh.lastMessage !== activeConv.lastMessage)) {
        setActiveConv(fresh);
      }
    }
  }, [conversations, activeConv]);

  // Auto-scroll to latest message whenever messages change or active conversation opens
  useEffect(() => {
    if (activeConv) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeConv?.id]);

  // Auto-focus input when active conversation opens
  useEffect(() => {
    if (activeConv) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [activeConv?.id]);

  // Auto-focus conversation if initiated from Leaderboard or prop
  useEffect(() => {
    if (peerIdToUse) {
      openConversationWithPeer(peerIdToUse);
    }
  }, [peerIdToUse, currentUser.id]);

  const openConversationWithPeer = (peerId: string) => {
    const cleanPeer = peerId.trim();
    if (!cleanPeer || cleanPeer === currentUser.id) return;

    const canonicalId = BoostPayStore.getCanonicalConversationId(currentUser.id, cleanPeer);
    const allConvs = BoostPayStore.getConversations();
    let existing = allConvs.find(c => c.id === canonicalId);

    if (!existing) {
      existing = {
        id: canonicalId,
        participants: cleanPeer === 'ADMIN_SUPPORT'
          ? [currentUser.id, 'ADMIN_SUPPORT']
          : [currentUser.id, cleanPeer].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        lastMessage: cleanPeer === 'ADMIN_SUPPORT' ? 'Official Support Channel' : 'Conversation initiated',
        lastMessageAt: Date.now()
      };
      allConvs.unshift(existing);
      BoostPayStore.saveConversations(allConvs);
      setConversations(allConvs);
    }
    setActiveConv(existing);
  };

  // Strictly filter conversations so the user only sees threads they are part of
  const userConversations = conversations.filter(c =>
    Array.isArray(c.participants) && c.participants.includes(currentUser.id)
  );

  const filteredConversations = userConversations.filter(c =>
    c.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.participants.some(p => p.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getOtherParticipant = (conv: Conversation): string => {
    return conv.participants.find(p => p !== currentUser.id) || (conv.participants.includes('ADMIN_SUPPORT') ? 'ADMIN_SUPPORT' : 'Support');
  };

  const handleStartNewConversation = (e: React.FormEvent) => {
    e.preventDefault();
    setNewChatError('');
    const cleanId = newPeerId.trim();

    if (!cleanId) {
      setNewChatError('Please enter a numeric User ID');
      return;
    }

    if (cleanId === currentUser.id) {
      setNewChatError('You cannot start a conversation with your own User ID');
      return;
    }

    const allUsers = BoostPayStore.getUsers();
    const peer = allUsers.find(u => u.id === cleanId);
    if (!peer && cleanId !== 'ADMIN_SUPPORT') {
      setNewChatError(`User ID #${cleanId} not found`);
      return;
    }

    openConversationWithPeer(cleanId);
    setIsNewChatOpen(false);
    setNewPeerId('');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !inputMsg.trim() || isSending) return;

    const textToSend = inputMsg.trim();
    const otherParticipant = getOtherParticipant(activeConv);

    setInputMsg('');
    setIsSending(true);

    try {
      await BoostPayStore.sendChatMessage(otherParticipant, textToSend, 'USER');
    } finally {
      setIsSending(false);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-6 text-zinc-100">
      {/* If active conversation is selected */}
      {activeConv ? (
        <div className="flex flex-col h-[75vh] rounded-3xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl overflow-hidden">
          {/* Conversation Top Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-2">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setActiveConv(null)}
                className="rounded-xl p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition cursor-pointer"
                title="Back to inbox"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="flex items-center gap-1.5">
                  {getOtherParticipant(activeConv) === 'ADMIN_SUPPORT' ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-sky-400 font-mono">
                      <ShieldCheck className="w-4 h-4 text-sky-400" />
                      Official Verified Support
                    </span>
                  ) : (
                    <span className="text-xs font-bold font-mono text-amber-400">
                      User #{getOtherParticipant(activeConv)}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono">
                  Room: {activeConv.id}
                </div>
              </div>
            </div>
          </div>

          {/* Persistent Scam Warning Notice at Top of Chat */}
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 px-3 py-2 mb-3 flex items-center gap-2 text-[11px] text-red-300">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
            <span>Never send external funds or share passwords. Official staff never asks for credentials.</span>
          </div>

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {messages
              .filter(m => m.conversationId === activeConv.id)
              .map(m => (
                <MessageItem
                  key={m.id}
                  m={m}
                  isMe={m.senderId === currentUser.id}
                  isAdmin={m.senderRole === 'ADMIN' || m.senderId === 'ADMIN_SUPPORT'}
                />
              ))}

            {messages.filter(m => m.conversationId === activeConv.id).length === 0 && (
              <div className="h-full flex items-center justify-center text-xs text-zinc-500 text-center px-4">
                Say hello to initiate this conversation. Real-time encryption active.
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input Form */}
          <form onSubmit={handleSendMessage} className="flex gap-2 pt-3 border-t border-zinc-800">
            <input
              ref={inputRef}
              type="text"
              placeholder="Type your message..."
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!inputMsg.trim()}
              className="rounded-2xl bg-amber-500 px-4 py-2.5 text-zinc-950 hover:bg-amber-400 transition font-bold disabled:opacity-40 disabled:hover:bg-amber-500 cursor-pointer active:scale-95"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        /* Conversations Inbox List */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-400" /> Messenger Inbox
              </h2>
              <p className="text-xs text-zinc-400">Direct peer communication & Verified Support</p>
            </div>
            <button
              onClick={() => setIsNewChatOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition shadow-lg shadow-amber-500/20 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> New Chat
            </button>
          </div>

          {/* 1-Tap Official Verified Support Banner */}
          <div
            onClick={() => openConversationWithPeer('ADMIN_SUPPORT')}
            className="flex items-center justify-between rounded-2xl border border-sky-500/30 bg-sky-950/30 p-3.5 hover:border-sky-500/60 hover:bg-sky-950/50 transition cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-xl p-2.5 bg-sky-500/20 text-sky-400">
                <Headphones className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-sky-400 font-mono flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Official Verified Support
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Need help with transfers, rates or boosts? Tap for 24/7 direct assistance.
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono text-sky-400 font-bold bg-sky-500/10 border border-sky-500/30 px-2 py-1 rounded-lg">
              Live
            </span>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search by User ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>

          {/* Conversations list */}
          <div className="space-y-2">
            {filteredConversations.map((conv) => {
              const other = getOtherParticipant(conv);
              const isSupport = other === 'ADMIN_SUPPORT';

              return (
                <button
                  key={conv.id}
                  onClick={() => setActiveConv(conv)}
                  className="w-full flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3.5 hover:border-zinc-700 hover:bg-zinc-900 transition text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <div className={`rounded-xl p-2.5 shrink-0 ${
                      isSupport ? 'bg-sky-500/20 text-sky-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {isSupport ? <ShieldCheck className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono text-zinc-200">
                          {isSupport ? 'Official Verified Support' : `User #${other}`}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate max-w-[240px] mt-0.5">
                        {conv.lastMessage || 'No messages yet'}
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                    {new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              );
            })}

            {filteredConversations.length === 0 && (
              <div className="py-12 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-2xl">
                No conversations found. Tap "New Chat" above to message a peer by numeric ID.
              </div>
            )}
          </div>

          {/* New Chat Modal */}
          {isNewChatOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl text-zinc-100">
                <h3 className="font-bold text-sm text-white mb-1">Start New Conversation</h3>
                <p className="text-xs text-zinc-400 mb-4">Enter recipient's numeric User ID (e.g. 1, 2, 3)</p>

                <form onSubmit={handleStartNewConversation} className="space-y-3">
                  <input
                    type="text"
                    placeholder="e.g. 2"
                    value={newPeerId}
                    onChange={(e) => setNewPeerId(e.target.value.replace(/\D/g, ''))}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 text-xs font-mono text-zinc-100 focus:border-amber-500 focus:outline-none"
                    autoFocus
                  />

                  {newChatError && (
                    <p className="text-xs text-red-400 font-medium">{newChatError}</p>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsNewChatOpen(false)}
                      className="flex-1 rounded-xl bg-zinc-800 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 rounded-xl bg-amber-500 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 shadow-md shadow-amber-500/20 cursor-pointer"
                    >
                      Open Chat
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
