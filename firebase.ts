import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Production Mode

// const firebaseConfig = {
//   apiKey: "AIzaSyB7FCdICCu2nuowwm4A4kxPFyC_QUBjPAU",
//   authDomain: "chat-pdf-e3d02.firebaseapp.com",
//   projectId: "chat-pdf-e3d02",
//   storageBucket: "chat-pdf-e3d02.appspot.com",
//   messagingSenderId: "929469713703",
//   appId: "1:929469713703:web:6c4332cd7ee09ec7b5ed02",
// };

// Test Mode

const firebaseConfig = {
  apiKey: "AIzaSyCLKiFf_PgsGmr2UBXo2Nm3Wp7rJgUlH2E",
  authDomain: "chat-pdf-testmode.firebaseapp.com",
  projectId: "chat-pdf-testmode",
  storageBucket: "chat-pdf-testmode.appspot.com",
  messagingSenderId: "626734558203",
  appId: "1:626734558203:web:d0b23d60dd72aa3821795e",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const db = getFirestore(app);
const storage = getStorage(app);

export { db, storage };
