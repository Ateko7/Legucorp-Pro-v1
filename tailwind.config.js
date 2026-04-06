/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#166534", // verde principal
          light: "#22c55e",
          dark: "#14532d",
        },
        accent: {
          DEFAULT: "#f59e0b", // amarillo
        },
        bg: {
          DEFAULT: "#f8fafc",
          card: "#ffffff",
          sidebar: "#0f172a",
        },
        text: {
          main: "#111827",
          soft: "#6b7280",
        }
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
      },
      boxShadow: {
        soft: "0 10px 25px rgba(0, 0, 0, 0.05)",
        card: "0 8px 30px rgba(0,0,0,0.06)",
      }
    },
  },
  plugins: [],
}