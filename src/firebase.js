import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAiMVd7U6SHGIDEToJW4XwA1Y4LjR7WwOY",
  authDomain: "yutai-app-a6412.firebaseapp.com",
  projectId: "yutai-app-a6412",
  storageBucket: "yutai-app-a6412.firebasestorage.app",
  messagingSenderId: "776672274592",
  appId: "1:776672274292:web:4b3e76afcbcff0b73cee21",
  measurementId: "G-23CQ7GX8P6",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
