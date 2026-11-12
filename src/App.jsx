import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const isSystemMsg = (m) => m.system || m.type === "system";
const initials = (name = "?") => name.slice(0, 1).toUpperCase();
const timeLabel = (iso) => {
  try {
    return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return "";
  }
};

const QUICK_REACTIONS = ["❤️", "😂", "👍", "🔥", "👏"];
const EMOJIS = ["😀", "😂", "😍", "🥰", "😎", "😭", "🔥", "❤️", "👍", "👏", "🎉", "🤔", "😮", "🙏", "💯"];

export default function App() {
  const [name, setName] = useState("");
  const [draftName, setDraftName] = useState("Alice");
  const [joined, setJoined] = useState(false);
  const [connected, setConnected] = useState(false);
  const [myId, setMyId] = useState(null);
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState("");
  const [notice, setNotice] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [whisperId, setWhisperId] = useState(null); // id of user we are privately messaging

  const socketRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);
  const lastTypingSent = useRef(false);
  const nameRef = useRef("");

  // ---- socket setup (runs once) ----
  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3001`, {
      transports: ["websocket", "polling"]
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setMyId(socket.id);
      setNotice("");
      // After a reconnect / server restart, join again automatically
      if (nameRef.current) socket.emit("user:join", nameRef.current);
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setTyping("");
    });

    socket.on("connect_error", () => {
      setConnected(false);
      setNotice("Could not reach the chat server. Check that the server is running.");
    });

    socket.on("chat:history", (history) =>
      setMessages(history.map((m) => (m.type === "system" ? { ...m, system: true } : m)))
    );

    socket.on("chat:message", (message) => setMessages((old) => [...old, message]));

    socket.on("system:message", (message) =>
      setMessages((old) => [...old, { ...message, system: true }])
    );

    socket.on("users:update", (list) => {
      setUsers(list);
      // a user who left can no longer be typing
      setTyping((t) => (t && !list.some((u) => t.startsWith(`${u.name} `)) ? "" : t));
    });

    socket.on("typing:update", ({ name: who, isTyping }) =>
      setTyping(isTyping ? `${who} is typing…` : "")
    );

    socket.on("message:reaction", ({ messageId, reactions }) =>
      setMessages((old) => old.map((m) => (m.id === messageId ? { ...m, reactions } : m)))
    );

    socket.on("message:updated", ({ messageId, text: newText, edited, editedAt }) =>
      setMessages((old) =>
        old.map((m) => (m.id === messageId ? { ...m, text: newText, edited, editedAt } : m))
      )
    );

    socket.on("message:private", (dm) => setMessages((old) => [...old, dm]));

    socket.on("message:deleted", ({ messageId }) =>
      setMessages((old) => old.filter((m) => m.id !== messageId))
    );

    return () => {
      clearTimeout(typingTimer.current);
      socket.disconnect();
    };
  }, []);

  // ---- always keep newest message in view ----
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing, joined]);

  // ---- actions ----
  const joinChat = (event) => {
    event.preventDefault();
    const clean = draftName.trim().slice(0, 18);
    if (!clean || !connected) return;
    setName(clean);
    nameRef.current = clean;
    setMessages([]); // clean slate; server sends the current room history
    setJoined(true);
    setNotice("");
    socketRef.current?.emit("user:join", clean);
  };

  const stopTyping = () => {
    clearTimeout(typingTimer.current);
    if (lastTypingSent.current) {
      socketRef.current?.emit("typing:update", false);
      lastTypingSent.current = false;
    }
  };

  const sendMessage = (event) => {
    event.preventDefault();
    const clean = text.trim();
    if (!clean || !connected || !joined) return;
    if (whisperTarget) {
      socketRef.current?.emit("message:private", { targetId: whisperTarget.id, text: clean });
    } else {
      socketRef.current?.emit("chat:message", clean);
    }
    setText("");
    setShowEmoji(false);
    stopTyping();
  };

  const updateDraft = (value) => {
    setText(value);
    if (!joined || !connected) return;
    if (!lastTypingSent.current) {
      socketRef.current?.emit("typing:update", true);
      lastTypingSent.current = true;
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.emit("typing:update", false);
      lastTypingSent.current = false;
    }, 1000);
  };

  const addEmoji = (emoji) => setText((old) => old + emoji);

  const reactToMessage = (messageId, emoji) =>
    socketRef.current?.emit("message:react", { messageId, emoji });

  const copyMessage = (messageText) => {
    navigator.clipboard?.writeText(messageText).catch(() => {});
  };

  const editMessage = (message) => {
    const next = window.prompt("Edit your message", message.text);
    if (next === null) return;
    const clean = next.trim();
    if (!clean || clean === message.text) return;
    socketRef.current?.emit("message:edit", { messageId: message.id, newText: clean });
  };

  const deleteMessage = (messageId) => {
    if (window.confirm("Delete this message for everyone?")) {
      socketRef.current?.emit("message:delete", messageId);
    }
  };

  // ---- derived ----
  const me = users.find((u) => u.id === myId);
  const myName = me?.name || name; // server may have renamed us (e.g. Alice_42)
  const others = users.filter((u) => u.id !== myId);
  const whisperTarget = users.find((u) => u.id === whisperId); // undefined once they leave
  const isMine = (message) => message.senderId === myId;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><span>•••</span></div>
          <div>
            <div className="brand-name">Chat<span>Connect</span></div>
            <div className="brand-tagline">Chat · Connect · Feel closer</div>
          </div>
        </div>

        <div className="side-label">YOUR SPACE</div>
        <div className={`person-card ${joined ? "selected" : ""}`}>
          <div className="avatar avatar-blue">{initials(myName || draftName || "A")}</div>
          <div className="person-meta">
            <strong>{myName || "You"}</strong>
            <span>
              <i className={`status-dot ${connected ? "online" : ""}`} />
              {connected ? "Connected" : "Connecting…"}
            </span>
          </div>
          <span className="you-pill">YOU</span>
        </div>

        {others.map((user, index) => (
          <div
            className={`person-card ${whisperId === user.id ? "selected" : ""}`}
            key={user.id}
            style={{ cursor: "pointer" }}
            title="Click to send a private message"
            onClick={() => setWhisperId(whisperId === user.id ? null : user.id)}
          >
            <div className={`avatar ${index % 2 ? "avatar-pink" : "avatar-purple"}`}>
              {initials(user.name)}
            </div>
            <div className="person-meta">
              <strong>{user.name}</strong>
              <span>
                <i className="status-dot online" />
                {whisperId === user.id ? "Private chat 🔒" : "Online"}
              </span>
            </div>
          </div>
        ))}
        {others.length === 0 && <div className="waiting-note">Waiting for others to join…</div>}

        <div className="sidebar-bottom">
          <div className="side-link">
            <span className="side-icon">✦</span>
            <span>Private room</span>
            <span className="secure-label">LAN</span>
          </div>
          <div className="server-card">
            <div className="server-pulse"><i /></div>
            <div>
              <strong>{connected ? "Server connected" : "Connecting to server"}</strong>
              <small>{connected ? "Your messages are live" : "Checking connection…"}</small>
            </div>
          </div>
          <div className="sidebar-foot">
            <span className="lock-icon">⌑</span> Same Wi-Fi · Local network chat
          </div>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div className="header-avatar"><span>✦</span></div>
          <div className="header-copy">
            <h1>The Hangout</h1>
            <p>
              <span className={`status-dot ${connected ? "online" : ""}`} />
              {connected
                ? `${users.length} ${users.length === 1 ? "person" : "people"} in this room`
                : "Connecting to your room…"}
            </p>
          </div>
          <div className={`connection-badge ${connected ? "good" : ""}`}>
            <span className="wifi-icon">⌁</span>
            {connected ? "Live connection" : "Reconnecting"}
          </div>
        </header>

        {!joined ? (
          <div className="welcome-wrap">
            <div className="welcome-orb"><span>✦</span></div>
            <p className="eyebrow">YOUR OWN LITTLE CORNER</p>
            <h2>Good conversations<br /><em>start here.</em></h2>
            <p className="welcome-description">
              Choose a name and step into the room. Friends can join from any device on the same Wi-Fi.
            </p>
            <form className="join-form" onSubmit={joinChat}>
              <label htmlFor="displayName">Your display name</label>
              <input
                id="displayName"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={18}
                placeholder="Alice or Bob"
              />
              <button
                className="primary-button join-button"
                type="submit"
                disabled={!connected || !draftName.trim()}
              >
                Enter the chat <span>↗</span>
              </button>
            </form>
            <div className="welcome-foot">
              <span>✓</span> No account needed <b>·</b> Just your browser
            </div>
          </div>
        ) : (
          <>
            <div className="message-area">
              <div className="date-divider"><span /> <label>MESSAGES</label> <span /></div>

              {messages.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">✉</div>
                  <h3>It’s quiet in here…</h3>
                  <p>Send the first message and get things going.</p>
                </div>
              )}

              {messages.map((message, index) => {
                if (isSystemMsg(message)) {
                  return (
                    <div className="system-message" key={message.id}>
                      <span>✦</span>{message.text}
                    </div>
                  );
                }

                const mine = isMine(message);
                const previous = messages[index - 1];
                const isPrivate = message.type === "private";
                const grouped =
                  previous &&
                  !isSystemMsg(previous) &&
                  !isPrivate &&
                  previous.type !== "private" &&
                  previous.senderId === message.senderId;
                const hasReactions =
                  message.reactions && Object.keys(message.reactions).length > 0;

                return (
                  <div
                    className={`message-row ${mine ? "mine" : "theirs"} ${grouped ? "grouped" : ""}`}
                    key={message.id}
                  >
                    {!mine && !grouped && <div className="message-avatar">{initials(message.sender)}</div>}
                    {!mine && grouped && <div className="avatar-spacer" />}

                    <div className="message-content">
                      {isPrivate ? (
                        <div className="sender-name">
                          🔒 {mine ? `You → ${message.targetName}` : `${message.sender} → you`}
                        </div>
                      ) : (
                        !mine && !grouped && <div className="sender-name">{message.sender}</div>
                      )}
                      <div className="bubble">{message.text}</div>

                      {/* hover toolbar (floats above the bubble) */}
                      {!isPrivate && (
                      <div className="message-actions">
                        {QUICK_REACTIONS.map((emoji) => (
                          <button
                            type="button"
                            key={emoji}
                            onClick={() => reactToMessage(message.id, emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                        <button type="button" onClick={() => copyMessage(message.text)} title="Copy message">
                          📋
                        </button>
                        {mine && (
                          <>
                            <button type="button" onClick={() => editMessage(message)} title="Edit message">
                              ✏️
                            </button>
                            <button type="button" onClick={() => deleteMessage(message.id)} title="Delete message">
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
                      )}

                      {!isPrivate && hasReactions && (
                        <div className="reaction-list">
                          {Object.entries(message.reactions).map(([emoji, reactors]) => (
                            <button
                              type="button"
                              key={emoji}
                              onClick={() => reactToMessage(message.id, emoji)}
                            >
                              {emoji} {reactors.length}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="message-meta">
                        {timeLabel(message.time)}
                        {message.edited && <span>· edited</span>}
                        {isPrivate && <span>· private</span>}
                        {mine && <span className="read-check">✓✓</span>}
                      </div>
                    </div>

                    {mine && !grouped && <div className="message-avatar mine-avatar">{initials(myName)}</div>}
                    {mine && grouped && <div className="avatar-spacer" />}
                  </div>
                );
              })}

              {typing && (
                <div className="typing-row">
                  <div className="typing-dots"><i /><i /><i /></div>
                  <span>{typing}</span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {notice && (
              <div className="notice">
                {notice}
                <button type="button" onClick={() => setNotice("")}>×</button>
              </div>
            )}

            {showEmoji && (
              <div className="emoji-picker">
                {EMOJIS.map((emoji) => (
                  <button type="button" key={emoji} onClick={() => addEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {whisperTarget && (
              <div className="notice">
                🔒 Private message to <b>{whisperTarget.name}</b>. Only you two will see it.
                <button type="button" onClick={() => setWhisperId(null)}>×</button>
              </div>
            )}

            <form className="composer" onSubmit={sendMessage}>
              <div className="composer-inner">
                <span className="composer-spark">✧</span>
                <input
                  value={text}
                  onChange={(e) => updateDraft(e.target.value)}
                  placeholder={
                    !connected
                      ? "Waiting for server connection…"
                      : whisperTarget
                      ? `Private message to ${whisperTarget.name}…`
                      : "Write a message… (try /help)"
                  }
                  disabled={!connected}
                  aria-label="Message"
                />
                <span className="enter-hint">↵</span>
                <button
                  type="button"
                  className="emoji-toggle"
                  onClick={() => setShowEmoji((v) => !v)}
                >
                  😀
                </button>
              </div>
              <button
                className="send-button"
                type="submit"
                disabled={!text.trim() || !connected}
                aria-label="Send message"
              >
                <span>➤</span>
              </button>
            </form>
            <div className="composer-caption">
              Be kind. Keep the conversation going. <span>Messages are shared with everyone in this room.</span>
            </div>
          </>
        )}
      </section>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
    </main>
  );
}
