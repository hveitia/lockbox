import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    self.contentViewController = flutterViewController

    // Open filling the screen. `visibleFrame` is the screen minus the menu bar
    // and the Dock, so the window is maximized without entering a macOS
    // fullscreen Space: the vault stays one Cmd+Tab away from whatever is
    // being worked on, which is the point of a tool you open to copy one
    // password. Falls back to the nib's frame if no screen reports in.
    let frame = (self.screen ?? NSScreen.main)?.visibleFrame ?? self.frame
    self.setFrame(frame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)

    super.awakeFromNib()
  }
}
