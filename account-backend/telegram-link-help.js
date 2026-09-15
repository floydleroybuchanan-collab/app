export const TELEGRAM_LINK_STEPS=[
 'Existing accounts, including accounts created before Mr Charm: complete these steps only if no verified account link is shown. Saving a Telegram contact in the web panel is not account verification.',
 '1. Open the Charming MediaLab Android app on a TV or Android phone and sign in to your existing account. Do not create a second account or request a new invitation.',
 '2. Inside the app, open Settings → Account → Link Telegram / Account Recovery. This is the Android app’s Settings, not the web panel.',
 '3. Enter your current app password inside the app. Scan the displayed QR with your phone, or privately send Mr Charm Link My Account followed by the request code shown in the app.',
 '4. In Telegram, use the identity you want linked and approve only the request you just started. Return to the app and check that verification completed. Requests expire after ten minutes.',
 'If you cannot sign in or a different Telegram identity is already linked, ask an authorized admin for verified account recovery. Never send your password to the bot.',
];
export const ADMIN_LINK_STEPS=[
 'For your own admin access, use your existing app/panel administrator login in the Android app and follow the steps above. A Telegram group-admin badge or saved contact alone does not enable account-management commands.',
 'To help another user: send them the steps above so they can verify their own account. If your own admin identity is already verified and you have account-recovery permission, Link Account can instead link their exact app username to their permanent numeric Telegram ID after you verify ownership and confirm the action. Use Relink Account only when replacing an existing identity after verification.',
 'A Telegram username change does not require relinking: verified links use the permanent Telegram ID. Accounts that already show a verified link do not need these steps again.',
];
export const telegramLinkHelp=(admin=false)=>[...TELEGRAM_LINK_STEPS,...(admin?ADMIN_LINK_STEPS:[])].join('\n\n');
