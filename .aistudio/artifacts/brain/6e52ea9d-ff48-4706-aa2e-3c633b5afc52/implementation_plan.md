# Real-Time Chat Engine & Instant SSE Synchronization

Fix and upgrade BoostPay's peer-to-peer and admin support messaging into a zero-latency, server-authoritative real-time chat engine powered by Server-Sent Events (SSE), atomic message persistence, conversation isolation, and interactive floating toast notifications.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions have been confirmed and will guide the implementation:

- **Confirmed Decision 1 (Real-Time Transport)**: Real-time Server-Sent Events (`/api/chat/stream`) with immediate push broadcast upon message receipt, backed by an atomic HTTP POST endpoint (`/api/chat/send`) and connection recovery fallback.
- **Confirmed Decision 2 (Notification & Alert UX)**: Instant floating toast alert preview when a message arrives from a peer or Verified Support while on another screen, with 1-tap direct jump to the chat thread and an unread badge on the bottom navigation dock.
- **Confirmed Decision 3 (Data Isolation & Privacy)**: Canonical conversation IDs based on sorted participant IDs (`CONV-1-2`) and strict user isolation so users only see their own direct conversations and private Verified Support tickets (eliminating the bug where all users saw each other's support messages).

---

## 1. Overview & Core Concept

- **What It Does**: Enables instant, bidirectional real-time messaging between BoostPay users (by User ID) and between users and official Verified Support in the Admin Portal. Messages deliver with zero perceptible lag (<50ms) across browser tabs, windows, and devices without full database re-fetching or state overwrites.
- **Target Audience / Persona**: BoostPay users transacting funds, verifying transfers, or contacting Official Support for assistance, as well as administrators managing customer inquiries from the Admin Console.
- **Key Value**: Replaces destructive whole-database polling with atomic, append-only message storage and instant SSE broadcast, resolving message loss, conversation collision, and synchronization lag.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. *Starting a Chat*: From the Messenger tab or by tapping "Message" on any user in the Leaderboard, the app opens or creates the canonical thread with that user. A persistent "Verified Support" quick-launcher is pinned at the top for instant help.
  2. *Active Conversation Experience*:
     - Sticky conversation header with participant identifier, verification status badge, and back button.
     - Auto-scrolling message viewport that sticks to the bottom when new messages arrive.
     - High-contrast message bubbles: Amber bubble for current user (right-aligned), sky-blue bubble with verified shield for Official Support, and dark slate bubble for peer users (left-aligned).
     - Form input with send button, Enter-to-send support, and disabled state while empty or submitting.
  3. *Cross-Screen Alert*: If User B receives a message from User A or Support while viewing Wallet, Leaderboard, or Inbox:
     - A floating toast alert slides down showing the sender and a message snippet.
     - Tapping the toast immediately switches to the Messenger tab and focuses that conversation.
     - A subtle badge indicates unread activity on the Chat tab.
  4. *Admin Support Workflow*: In the Admin Portal's Support tab, the admin can view real-time incoming user threads, click to inspect full history, and reply as `ADMIN_SUPPORT`, which instantly pushes to the user's screen in real time.

- **Visual Identity & Theme**:
  - *Color Palette*: Consistent Zinc/Amber dark theme (`bg-zinc-950`, `bg-zinc-900`, `border-zinc-800`), with `amber-500` accents for user bubbles and `sky-400` / `sky-950` for Verified Support.
  - *Typography*: Clean tabular mono timestamps (`text-[9px] font-mono`), bold user identifiers (`User #1`), and balanced prose for message bodies.
  - *Motion & Feedback*: Smooth scroll behavior (`scrollIntoView({ behavior: 'smooth' })`), subtle send button active transform (`active:scale-95`), and smooth slide-in for incoming floating toast banners.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Server-Sent Events (SSE) over Polling or WebSockets**
  - *Chosen Approach*: Implement an HTTP SSE route (`/api/chat/stream?userId=:userId`) with an array of active response streams on the server.
  - *Why*: SSE works natively over HTTP/1.1 and HTTP/2 in all modern browsers without additional heavy WebSocket library dependencies, fits seamlessly into Express and Vite middleware, handles automatic reconnects, and delivers instantaneous sub-10ms push.
  - *Alternatives Considered*: 500ms full `/api/db` polling (caused server bloat, race conditions, and erased messages) and WebSockets (required additional libraries and upgrade handshake management).

- **Decision 2: Atomic Append-Only Server Route (`/api/chat/send`)**
  - *Chosen Approach*: When a user or admin sends a message, they POST directly to `/api/chat/send` with `{ conversationId, senderId, senderRole, recipientId, text }`. The server atomically appends the message, updates the conversation's `lastMessage` and `lastMessageAt`, persists to disk, and immediately broadcasts the payload to connected SSE listeners.
  - *Why*: Eliminates the fatal race condition in `/api/sync` where client snapshots completely wiped other clients' messages.

- **Decision 3: Canonical Conversation Pairing & Strict Privacy Filtering**
  - *Chosen Approach*: Derive conversation IDs canonically: `CONV-MIN(idA, idB)-MAX(idA, idB)` for peer conversations, and `CONV-USER_ID-ADMIN_SUPPORT` for support threads. Filter conversations strictly by `c.participants.includes(currentUser.id)`.
  - *Why*: Guarantees both participants access the exact same thread regardless of who initiated the conversation, and prevents users from seeing other users' private support tickets.

---

## 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         BoostPay Full-Stack Architecture                  │
└──────────────────────────────────────────────────────────────────────────┘

  [ Client A (User 1) ]             [ Express Server (server.ts) ]         [ Client B (User 2) ]
          │                                      │                                  │
          │── GET /api/chat/stream?userId=1 ────>│                                  │
          │   (SSE Connection established)       │<── GET /api/chat/stream?userId=2─│
          │                                      │    (SSE Connection established)  │
          │                                      │                                  │
          │── POST /api/chat/send ──────────────>│                                  │
          │   { senderId: '1', recipientId: '2', │                                  │
          │     text: 'Hello!' }                 │                                  │
          │                                      │                                  │
          │                           [ Atomic Persistence ]                        │
          │                           • Canonical ID: CONV-1-2                      │
          │                           • Append to db.messages                       │
          │                           • Update db.conversations                     │
          │                           • writeDb(db)                                 │
          │                                      │                                  │
          │<── SSE Broadcast 'new_message' ──────┼── SSE Broadcast 'new_message' ──>│
          │    (Instant Local UI Refresh)        │   (Instant Toast Alert + Badge)  │
          │                                      │                                  │
```

### Components to Update:
1. `server.ts`:
   - Add SSE connection registry (`activeChatClients: Set<Response>`).
   - Add `GET /api/chat/stream`: Stream SSE events (`new_message`, `conversation_update`).
   - Add `GET /api/chat/messages`: Fetch conversation history with query params.
   - Add `POST /api/chat/send`: Server-authoritative atomic message dispatcher that writes to storage, creates inbox alert notification for recipient if needed, and broadcasts via SSE.
   - Update `/api/sync` to merge messages and conversations non-destructively instead of replacing them wholesale.
2. `src/services/store.ts`:
   - Implement `BoostPayStore.initChatStream(userId)` with SSE `EventSource` and automatic reconnection.
   - Implement `BoostPayStore.sendMessage(conversationId, recipientId, text)` calling `/api/chat/send`.
   - Update `BoostPayStore.syncChatState()` to use dedicated endpoints rather than whole-db fetch.
3. `src/components/MessengerView.tsx`:
   - Connect to real-time chat stream.
   - Add auto-scroll ref targeting the latest message.
   - Canonicalize conversation IDs so both peers always match.
   - Filter conversations strictly to the logged-in user's threads.
   - Add quick "Verified Official Support" direct chat launcher.
4. `src/components/AdminPortal.tsx`:
   - Connect admin support console to the real-time chat stream and `/api/chat/send`.
   - Enable instant two-way messaging between Admin and Users.
5. `src/App.tsx`:
   - Display incoming chat toast notifications with 1-tap jump to `MESSENGER` and conversation autofocus.
   - Display dynamic unread badge count on the Messenger navigation tab.
