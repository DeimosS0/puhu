// The internet, for the island: lost, and back. Windows tells us when the network
// changes (NetworkInformation.NetworkStatusChanged); we ask whether the profile in use
// still reaches the internet and say so only when that changes. Nothing polls. The
// island waits a moment before saying it is gone, so a blip says nothing. Linux has no
// indicator yet.

#[cfg(windows)]
pub use imp::start;

#[cfg(not(windows))]
pub fn start(_app: &tauri::AppHandle) {}

#[cfg(windows)]
mod imp {
    use std::sync::Mutex;

    use tauri::{AppHandle, Emitter};
    use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation, NetworkStatusChangedEventHandler};

    use crate::island::WINDOW_LABEL;

    /// Online at the last change: the first reading is the state, not a change.
    static ONLINE: Mutex<Option<bool>> = Mutex::new(None);

    fn online() -> bool {
        NetworkInformation::GetInternetConnectionProfile()
            .and_then(|p| p.GetNetworkConnectivityLevel())
            .is_ok_and(|level| level == NetworkConnectivityLevel::InternetAccess)
    }

    fn check(app: &AppHandle) {
        let now = online();
        let was = ONLINE.lock().unwrap().replace(now);
        if was.is_some_and(|was| was != now) {
            let _ = app.emit_to(WINDOW_LABEL, "network", now);
        }
    }

    pub fn start(app: &AppHandle) {
        let app = app.clone();
        check(&app);
        let handler = NetworkStatusChangedEventHandler::new(move |_| {
            check(&app);
            Ok(())
        });
        // Registered for the app's life: the token is never needed to remove it.
        if let Err(err) = NetworkInformation::NetworkStatusChanged(&handler) {
            crate::log::line(format!("network: no status events ({err})"));
        }
    }
}
