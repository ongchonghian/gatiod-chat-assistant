import { Box, Typography, AppBar, Toolbar, Chip } from "@mui/material";
import LocalHospitalIcon from "@mui/icons-material/LocalHospital";
import ChatPanel from "./components/ChatPanel";

export default function App() {
  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: "primary.dark", borderBottom: "1px solid", borderColor: "divider" }}>
        <Toolbar sx={{ gap: 1.5 }}>
          <LocalHospitalIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" sx={{ flexGrow: 1, letterSpacing: "-0.02em" }}>
            GATIOD Assessment Assistant
          </Typography>
          <Chip label="Upper Limb MVP" size="small" sx={{ bgcolor: "rgba(255,255,255,0.15)", color: "#fff", fontWeight: 500, fontSize: "0.75rem" }} />
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, overflow: "hidden" }}>
        <ChatPanel />
      </Box>
    </Box>
  );
}
