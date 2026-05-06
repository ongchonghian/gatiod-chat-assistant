import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1a3a5c", light: "#2d5f8a", dark: "#0d1f33" },
    secondary: { main: "#2e7d6f", light: "#4ba394", dark: "#1b5e50" },
    background: { default: "#f5f6f8", paper: "#ffffff" },
    text: { primary: "#1a1d23", secondary: "#5a6170" },
    success: { main: "#2e7d6f" },
    warning: { main: "#d4880f" },
    error: { main: "#c4342d" },
    divider: "#e2e5ea",
  },
  typography: {
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    h5: { fontWeight: 600, letterSpacing: "-0.01em" },
    h6: { fontWeight: 600, letterSpacing: "-0.005em" },
    subtitle1: { fontWeight: 500 },
    body2: { lineHeight: 1.6 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 600, borderRadius: 8 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)" },
      },
    },
  },
});
