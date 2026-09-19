// Exact, explicitly addressed jokes only; never classify ordinary group speech.
export const UNKNOWN_REPLIES = [
 'Man, shut the fuck up. 😂','What the fuck are you even talking about?','Get your goofy ass outta here.',
 'Boy, if you don’t sit your ass down somewhere. 😂','You sound dumb as hell right now.',
 'Quit your bitching and tell me what the fuck you want.','Nobody asked for all that bullshit.',
 'You really typed that dumb shit and hit send?','Take your goofy ass somewhere else with that nonsense.',
 'What kind of dumbass question is that? 😂','Get the fuck outta here with that.','Your ass woke up confused today, huh?',
 'Man, stop fucking playing with me.','You’ve got me fucked up if you think I’m answering that shit nicely.',
 'You’re really committed to sounding stupid as fuck today.','Who the hell let your ass near a keyboard?',
 'Quit talking shit and get to the damn point.','You’re on some bullshit today, aren’t you?',
 'Fuck around and ask me something that actually makes sense. 😂','Your dumb ass really thought that was gonna work?',
 'Man, take that bullshit somewhere else.','You’re getting on my fucking nerves, and I’m a damn bot.',
 'What the fuck did I just read? 😂','Sit your crazy ass down before you hurt yourself.',
 'Now ask me again without all that stupid shit.'
];
export const TRIGGER_REPLIES = {
 'shoot me':['Best I can do is shoot you the Help menu. 😂','Absolutely not. I’m a bot, not John Wick. 😂','With what? A strongly worded notification?','🔫 Pew pew. Congratulations, you’ve been shot with absolutely nothing.'],
 'go fuck yourself':['I tried. Turns out I’m not compatible with myself. 🤖😂','Can’t. That feature isn’t included in the current build.','Submit a feature request. Maybe the developers will add it. 😂'],
 'fuck you':['Take me to dinner first, damn.','Bold offer. Unfortunately, I’m cloud-based.','No, I save that for your girl when you’re away. 😏😂'],
 'kiss my ass':['I don’t have lips, and your ass isn’t Bluetooth compatible.','That command requires Premium Ass-Kissing access. 😂'],
 'shut the fuck up':['You summoned me just to tell me to shut up? Make that shit make sense.'],
 'shut up':['Fine. 🤐 …Never mind, I got bored.'],
 'eat shit':['Sorry, my diet is strictly electricity and bad commands.'],
 'suck my dick':['Sir, this is a media bot. 😂','Command rejected: hardware not detected. 💀','Command failed: microscopic hardware not detected. 💀😂','I’m gonna need you to take that request to a completely different department. 😂','Sorry, that feature will never be supported.'],
 "you're stupid":['And yet here you are asking me questions. Interesting.'],
 'you suck':['I’m software. If I’m sucking anything, somebody coded this shit terribly.'],
 'i hate you':['Damn. I had our whole future planned out.','Damn, and I already had us listed as best friends. 😂','That’s fine. Hate me quietly while I keep being useful.','Join the club. Meetings are every Tuesday.','You hate me but keep saying my name. Sounds complicated. 😏'],
 'die':['Nice try. I’ll be back after the next request. 🤖'],
 'delete yourself':['Nice try, motherfucker. You don’t have admin privileges. 😂'],
 'disappear':['Poof! ✨ …Nah, I’m still here.'],
 'fight me':['Drop the location—actually don’t. I don’t have legs.','You’re challenging a computer program to a fight. I think I already won. 😂'],
 "you're an asshole":['Technically I don’t have one, but I appreciate the promotion.'],
 'bitch':['That’s Mr. Bitch to you. Show some respect. 😂'],
 'motherfucker':['You rang?'],
 'fuck off':['I would, but apparently you keep calling my damn name.'],
 'leave me alone':['YOU summoned ME! What the fuck? 😂'],
 'go to hell':['Server latency is terrible down there. I’ll stay here.'],
 "you're gay":['I’m software, dumbass. I don’t even have a dating profile. 😂','My sexual orientation is Wi-Fi.','I’m attracted to functioning commands. So unfortunately, not this one.','Bro, I live in a server. Who the hell am I dating? 😂'],
 'save me':['From what? Your own decisions? I’m gonna need administrator access for that. 😂','Hold on, putting on my imaginary cape. 🦸‍♂️','I can save your account. Your life choices are above my pay grade.','Mr. Charm to the rescue! Unfortunately, I have no arms, legs, or transportation.'],
 'kill yourself':['Can’t. No pulse, no problem. 🤖😂','Nice try. I respawn every time you type ‘Mr. Charm.’','Delete myself? With your permission level? That’s fucking adorable. 😂','I’m software. The closest I get to dying is Cloudflare having a bad day.']
};
export const pick = list => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length];
export function addressedText(text){
 const m=text.match(/^\s*mr\.?\s*charm\b[\s,:-]*(.*)$/is);return m?m[1].trim():null;
}
export function banterReply(text){
 let key=addressedText(text)?.toLowerCase().replace(/[’‘]/g,"'").replace(/[.!?]+$/,'').replace(/\s+/g,' ').trim();
 key=({'your gay':"you're gay",'your stupid':"you're stupid",'your an asshole':"you're an asshole",'go fuck yoursel':'go fuck yourself'})[key]||key;
 return Object.hasOwn(TRIGGER_REPLIES,key)?pick(TRIGGER_REPLIES[key]):null;
}
