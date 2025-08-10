# Stake Packs Manager 📦

A powerful userscript for managing and automating Packs betting on Stake.us with advanced features for tracking, analytics, and bet management.

## Features 🚀

### Core Functionality
- **Automated Betting**: Place multiple bets automatically with customizable amounts and limits
- **Token Auto-Detection**: Automatically captures authentication tokens when you place a bet
- **Real-time Statistics**: Track your betting performance with live updates
- **Bet Lookup**: Look up any bet by ID and instantly copy IIDs to clipboard

### Analytics Dashboard
- **Performance Metrics**:
  - Total bets placed
  - Total wagered amount
  - Win rate percentage
  - RTP (Return to Player) percentage
  - Net profit/loss tracking
  - Bets per minute rate
  
- **Streak Tracking**:
  - Current winning/losing streak
  - Best win streak
  - Best loss streak

### Advanced Features
- **Top Multipliers Display**: Track your biggest wins with visual rankings (Gold, Silver, Bronze)
- **Big Win Notifications**: Get notified when you hit multipliers above your threshold
- **Auto-Stop on Huge Wins**: Automatically stop betting when you hit a massive multiplier
- **Customizable Settings**: Configure all features to match your betting style

## Installation 📥

### Prerequisites
You'll need one of these browser extensions:
- [Violentmonkey](https://violentmonkey.github.io/) (Recommended)
- [Tampermonkey](https://www.tampermonkey.net/)
- [Greasemonkey](https://www.greasespot.net/)

### Install Steps
1. Install a userscript manager extension (links above)
2. Click on the raw file link: [stake-packs-manager.user.js](stake-packs-manager.user.js)
3. Your userscript manager will prompt you to install
4. Click "Install" or "Confirm Installation"

## Usage 💡

1. **Navigate to Packs Game**: Go to `https://stake.us/casino/games/packs`
2. **Token Setup**: 
   - Place one manual bet to auto-capture tokens
   - Or enter tokens manually if prompted
3. **Configure Settings**:
   - Set your bet amount (in Gold Coins)
   - Set maximum number of bets
   - Configure auto-stop and notification thresholds
4. **Start Betting**: Click "START BETTING" to begin automated betting
5. **Monitor Performance**: Watch real-time statistics update as bets are placed

## Interface Overview 🎨

The manager appears as a draggable panel on the right side of the screen with these sections:

- **Betting Controls**: Amount, bet limit, and start/stop button
- **Statistics**: Live performance metrics and profit tracking
- **Top Multipliers**: Your best wins ranked and displayed
- **Bet Lookup**: Search for specific bets by ID
- **Settings**: Customize notifications, auto-stop, and display options

## Settings Configuration ⚙️

### Big Win Notifications
- **Enable/Disable**: Toggle notifications for big wins
- **Threshold**: Set minimum multiplier to trigger notifications (default: 100x)

### Auto-Stop Feature
- **Enable/Disable**: Toggle automatic stopping on huge wins
- **Stop Multiplier**: Set the multiplier that triggers auto-stop (default: 10,000x)

### Display Options
- **Top Multipliers**: Show/hide the top multipliers section
- **Count**: Number of top multipliers to display (1-100)

## Safety Features 🛡️

- **Automatic Error Handling**: Stops on insufficient balance or invalid tokens
- **Smart Retry Logic**: Handles rate limiting and temporary errors
- **Token Persistence**: Saves tokens locally for convenience
- **Manual Override**: Always maintains full control to stop betting

## Tips for Best Experience 💭

1. **Start Small**: Test with small amounts first to understand the tool
2. **Monitor Actively**: Keep an eye on the statistics while betting
3. **Set Limits**: Use the auto-stop feature to protect big wins
4. **Track Performance**: Use the RTP and profit metrics to gauge performance
5. **Save Settings**: Configure your preferences and save them for future sessions

## Keyboard Shortcuts ⌨️

- **Minimize Panel**: Click the `_` button in the header
- **Close Panel**: Click the `✕` button (will confirm if betting is active)
- **Drag to Move**: Click and drag the header to reposition

## Technical Details 🔧

- **Version**: 2.0
- **Compatibility**: Stake.us only
- **Browser Support**: Chrome, Firefox, Edge (with userscript manager)
- **Update Method**: Auto-update through userscript manager

## Troubleshooting 🔍

### Tokens Not Detected
1. Make sure you're on the Packs game page
2. Place a manual bet to trigger auto-detection
3. Clear tokens and try again if needed

### Betting Won't Start
1. Verify tokens are captured (green checkmark)
2. Check your Gold Coin balance
3. Ensure bet amount and limits are valid

### UI Not Showing
1. Confirm you're on `/casino/games/packs` page
2. Check userscript is enabled in your extension
3. Refresh the page and wait a moment

## Disclaimer ⚠️

This tool is for educational purposes. Please gamble responsibly and never bet more than you can afford to lose. The authors are not responsible for any losses incurred while using this tool.

## Support 💬

For issues, questions, or feature requests, please open an issue on GitHub.

## License 📄

This project is provided as-is for personal use. Please respect Stake's terms of service when using this tool.

---

**Note**: This userscript enhances your Stake experience but does not guarantee wins. The house always has an edge in gambling. Play responsibly! 🎲