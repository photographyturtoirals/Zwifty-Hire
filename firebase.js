const admin = require("firebase-admin");

if (!admin.apps.length) {
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // ✅ Production (Render)
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log("🔥 Firebase initialized using ENV credentials");
  } else {
    // ✅ Local development
    serviceAccount = require("./serviceAccount.json");
    console.log("🔥 Firebase initialized using LOCAL serviceAccount.json");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "zwifty-aea8b.appspot.com"
  });
}

module.exports = admin;
