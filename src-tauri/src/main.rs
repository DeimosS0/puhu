// Puhu runs without a console window: the owl is the whole UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    puhu_lib::run()
}
