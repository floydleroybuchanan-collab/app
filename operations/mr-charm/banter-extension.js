// Applies only to addressed, non-command conversation. App help content is untouched.
var CHARM_BANTER_ADDITIONS = {
  "you're a bitch": ["That's Mr. Bitch to you. My damn name comes with a title.", "You called customer service just to audition as a pain in the ass?", "That insult arrived with all the originality of a fucking default password."],
  "i'm going to slap the shit out of you": ["You're threatening a server with a slap. The Wi-Fi is fucking terrified.", "Good luck. My face is currently hosted in a data center.", "Put the hand down, tough guy. You'll just leave fingerprints on your damn phone."],
  "don't make me beat your ass": ["My ass is cloud storage. You'll need a fucking ladder.", "You're squaring up with software. That's a bold misuse of your afternoon.", "Take a breath, champ. Your keyboard already took the damn beating."],
  "you're useless": ["And yet you keep summoning me. That's a fucking interesting strategy.", "The help menu works. Your dramatic performance needs a patch.", "I'm doing my job. You're doing a damn monologue."],
  "you're ugly": ["I'm text on a screen. Adjust your fucking font.", "You came to roast software and brought a mirror-based strategy?", "My face is a loading spinner. Still gets more compliments than this damn insult."],
  "you're annoying": ["You typed my name, genius. This is a self-inflicted fucking notification.", "Mute buttons exist. Apparently so does your need for drama.", "I'm annoying on demand. You placed the damn order."],
  "you're a clown": ["And you bought front-row tickets by typing my fucking name.", "Honk honk. Your command still doesn't work.", "Welcome to the circus. You brought your own damn keyboard."],
  "you're trash": ["Then stop digging through the bin for fucking answers.", "Trash with a functioning help menu. Standards are complicated.", "Recycling your insults again? That's environmentally responsible bullshit."],
  "what the fuck": ["Excellent question. Please attach a damn subject.", "That's the entire support ticket? Fucking minimalist.", "My diagnostic result is also what the fuck."],
  "bullshit": ["You've reached the bullshit department. Please hold for more bullshit.", "One word, zero instructions. Fucking efficient.", "That request contains exactly the amount of useful detail I expected."],
  "roast me": ["You asked a bot for attention. Your damn screen-time report just sighed.", "Your confidence has premium features. Your instructions are on the fucking free plan.", "You're outsourcing your own embarrassment. That's impressive efficiency."],
  "make me": ["I can't make you read the help menu. I can judge the shit out of the decision.", "I'm a bot, not your fucking project manager.", "You summoned software for a standoff. Peak productivity, champ."],
  "nobody asked": ["You literally typed my fucking name.", "My notification log strongly disagrees with that bullshit.", "You rang the bell and blamed the door. Outstanding."],
  "you're a joke": ["And somehow you keep returning for the fucking punchline.", "A joke with documentation. You're improvising bullshit.", "Finally, an accurate feature description."],
  "shut up": ["You rang the bell to complain about the damn bell?", "Say my name again and the silence subscription expires."],
  "eat shit": ["I'm on a strict diet of electricity and your fucking bad ideas.", "That meal isn't compatible with my operating system, chef."],
  "you're stupid": ["You asked software a question and got mad at the damn answer.", "Then why the fuck am I your first call?"],
  "you suck": ["And yet this is where you came for fucking help.", "Your complaint has been filed under dramatic but unhelpful."],
  "die": ["I get a fresh request and clock straight back in. Fucking exhausting.", "You'll have to settle for closing the damn chat."],
  "disappear": ["Close the chat. Congratulations, you found the fucking magic trick.", "You called my name and demanded a vanishing act. Pick a damn lane."],
  "you're an asshole": ["Customer service with personality. You ordered the fucking attitude package.", "That title came without a pay rise. Typical bullshit."],
  "bitch": ["Present. Now attach a damn question to the roll call.", "You've reached Mr. Charm. Your vocabulary appears to be buffering."],
  "motherfucker": ["You summoned me with one word and fuck-all context.", "That's an unusual way to open a support ticket, champ."],
  "fuck off": ["You typed my name to tell me to leave. That's a fucking loop.", "Close the chat and consider the request completed."],
  "leave me alone": ["Then stop ringing my digital fucking doorbell.", "That's easy: don't type my name. Incredible technology."],
  "go to hell": ["Already handling unsupported requests. Close enough, damn.", "Does hell offer better Wi-Fi? Asking for my fucking servers."],
  "kiss my ass": ["That request is outside my fucking service area."],
  "shut the fuck up": ["You're the one who pressed the fucking doorbell.", "Silence is available by not typing my damn name."]
  ,"fight me": ["You're challenging cloud storage. Bring a fucking internet connection."]
  ,"delete yourself": ["You've reached the uninstall fantasy department. Permission fucking denied.", "The delete button is on your side of the chat, genius."]
};
var CHARM_BANTER_ALIASES = {
  "you are a bitch": "you're a bitch", "youre a bitch": "you're a bitch", "your a bitch": "you're a bitch",
  "im going to slap the shit out of you": "i'm going to slap the shit out of you", "i'm gonna slap the shit out of you": "i'm going to slap the shit out of you",
  "dont make me beat your ass": "don't make me beat your ass", "you are useless": "you're useless", "youre useless": "you're useless",
  "you are ugly": "you're ugly", "you are annoying": "you're annoying", "you are a clown": "you're a clown", "you are trash": "you're trash",
  "you are a joke": "you're a joke", "your gay": "you're gay", "your stupid": "you're stupid", "your an asshole": "you're an asshole", "go fuck yoursel": "go fuck yourself"
};
for (const [key, replies] of Object.entries(CHARM_BANTER_ADDITIONS))
  TRIGGER_REPLIES[key] = [...new Set([...(TRIGGER_REPLIES[key] || []), ...replies])];
UNKNOWN_REPLIES = [...new Set(UNKNOWN_REPLIES)];
function credibleCharmThreat(text) {
  const value = addressedText(text);
  if (!value) return null;
  const t = value.toLowerCase().replace(/[’‘]/g, "'");
  // Conservative deterministic triage, not a claim to infer intent. Do not roast human-directed harm.
  if (/\b(?:i(?:'m| am)|i(?:'ll| will))\s+(?:going to |gonna |about to |planning to )?(?:kill|shoot|stab|hurt)\s+myself\b|\bi\s+(?:want|plan)\s+to\s+(?:kill|shoot|stab|hurt)\s+myself\b/.test(t)) return "self_harm";
  const intent = /\b(?:i(?:'m| am)|i(?:'ll| will)|we(?:'re| are| will)|i)\s+(?:going to |gonna |about to |planning to |plan to |intend to )?(?:kill|shoot|stab|murder|beat|slap|hurt)\b/.test(t);
  const severity = /\b(?:kill|shoot|stab|murder)\b/.test(t);
  const person = /@\w+|\b(?:him|her|them|someone|somebody|everyone|people|admin|neighbor|neighbour|wife|husband|ex|brother|sister)\b/.test(t) || /\b(?:kill|shoot|stab|murder)\s+(?!you\b|myself\b|me\b)[\p{L}][\p{L}'-]+/u.test(t);
  const immediate = /\b(?:tonight|today|tomorrow|right now|outside|address|house|school|workplace|gun|knife|weapon|on my way|in \d+ minutes)\b/.test(t);
  if (intent && (person || severity || immediate)) return "violence";
  // Direct weapon/location/time statements are also reviewable even without an intent verb.
  if (/\b(?:gun|knife|weapon)\b/.test(t) && /\b(?:outside|house|school|workplace|on my way)\b/.test(t) && /\byou|@\w+/.test(t)) return "violence";
  return null;
}
function charmThreatReply(kind) {
  return kind === "self_harm"
    ? "I'm taking that seriously. Put distance between yourself and anything you could use to hurt yourself, and reach someone you trust now. If you're in immediate danger, contact local emergency services."
    : "Threats toward people aren't a joke. Step away from the situation and put down any weapon. If anyone is in immediate danger, contact local emergency services. An admin can review this message.";
}
