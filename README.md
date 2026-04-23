# Prep: AI-Powered Recipe Generator & Meal Planner 🥗📱

> **Final Year Project** | BSc (Honours) in Computer Science  
> **Atlantic Technological University (ATU)** > **Student:** Adam Grimes

![Project Status](https://img.shields.io/badge/Status-Complete-brightgreen)
![License](https://img.shields.io/badge/License-MIT-blue)


## 🎯 Project Objective & Detection Pipeline

The primary objective of **Prep** was to deliver a functional cross-platform mobile application that reduces household food waste and decision fatigue by turning users' existing ingredients into actionable recipes and organised meal plans. 

The project successfully produced a complete application. The application allows users to photograph the ingredients they already have. It then leverages Computer Vision and Generative AI to create personalized recipes and weekly meal plans based on those ingredients, aligning with the user's dietary goals, allergies, and time constraints.

A specialised two-stage detection pipeline was used to improve ingredient identification accuracy in realistic, cluttered kitchen environments.

---

## 🚀 Key Features
* **📸 Snap & Scan:** Two-stage detection pipeline:
	- **Stage 1 — Localisation (YOLOv8l-Worldv2):** A world-aware YOLO model is used to localise likely food items and produce focused image crops for further analysis.
	- **Stage 2 — Identification (Gemini 2.5 Flash):** Google Gemini (Gemini 2.5 Flash) is run on the cropped images to identify exact ingredients. The hybrid approach (YOLO for localisation + Gemini for fine-grained identification) overcomes the accuracy limitations of using object detection alone, particularly in cluttered or occluded scenes.
* **🤖 AI Chef:** Integrates the **Google Gemini LLM** to generate unique, personalized recipes based on scanned ingredients.
* **📅 Smart Meal Planning:** Generates multi-day meal plans based on user preferences, calorie goals and dietary restrictions.
* **📱 Cross-Platform Mobile App:** A responsive, modern interface built with **React Native Expo**.
* **⚙️ Robust API:** A custom backend built with **Django REST Framework** to handle AI processing and user data.

---

## 🛠 Tech Stack

### **Frontend (Mobile)**
* **Framework:** React Native (via Expo)
* **Language:** JavaScript/TypeScript
* **Navigation:** React Navigation

### **Backend (API & AI)**
* **Framework:** Django & Django REST Framework (DRF)
* **Language:** Python
* **Computer Vision:** YOLO (You Only Look Once) world model
* **Generative AI:** Google Gemini API
* **Database:** SQLite (Dev) / PostgreSQL (Prod)

---

## 🏗 Architecture

The system follows a client-server architecture and processes images with a two-stage detection + generation pipeline:

1.  **Client (Expo):** Captures an image and sends it, with any user preferences, to the backend.
2.  **API (Django):** Validates the upload and orchestrates the detection and generation pipeline (runs synchronously or enqueues jobs as configured).
3.  **AI Layer 1 — Localisation (YOLOv8l-Worldv2):** Localises likely food items and produces cropped image regions for each detection. If no reliable detections are found, the full image is used as a fallback.
4.  **AI Layer 2 — Identification (Gemini 2.5 Flash):** Analyses each crop to identify exact ingredients and returns a consolidated ingredient list.
5.  **Recipe Generation (Gemini 2.5 Flash Lite):** Uses the identified ingredients plus user preferences (calories, allergies, cuisine, skill level) to generate structured recipe JSON (title, description, ingredients, steps, times, calories).
6.  **Response:** The API returns the recipe/meal-plan JSON; the client renders results and saves to the meal planner or saved recipes.

---

## 📅 Development Roadmap
> **Status:** This project is no longer under active development and is complete as of 23 April 2026. The codebase reflects the final submitted state.

## 📦 Project Status

The implementation in this repository represents the final state of the Final Year Project. The system is considered complete — no active development is planned. The sections below remain for historical reference.

## Deployment & Hosting

- **Backend:** Django REST backend deployed on Railway (cloud platform). The deployment is configured via the repository's deployment files (for example, `Procfile`) and environment variables. 
- **Frontend:** Mobile builds were produced using Expo/EAS; Android builds can be made available as APKs (see the APK section below).

### Historical Roadmap (completed)

- [x] **Weeks 1-4:** Backend Setup, Unit Testing, Django REST API implementation, YOLO integration, Gemini API connection.
- [x] **Weeks 5-9:** Frontend Mobile App Development (React Native UI/UX, Camera integration, API fetch).
- [x] **Weeks 10-12:** Full-stack Integration, and Final Documentation.

## 📱 Android APK

- **APK download:** [https://expo.dev/artifacts/eas/tnjQFjg2voYaxGu4bNGNBq.apk]

---
---

