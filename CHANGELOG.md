# CHANGELOG - AKM-POS

## [2.1.0] - 2025-01-04

### Major Improvements: Code Quality & Organization

#### Added
- config.js - Centralized configuration
- utils.js - Common utility functions
- JSDoc documentation
- CHANGELOG.md

#### Changed
- firebase-config.js - Uses centralized config
- firestore-utils.js - Better documentation
- dashboard.js - Imports from config.js
- app-firestore.js - Uses centralized settings

#### Removed (Moved to Backup)
- app.js (old Google Sheets version)
- repair-management.js (old version)

#### Fixed
- Memory leak prevention
- Code duplication eliminated
- Consistent configuration

## [2.0.0] - 2024-12-30

### Firestore Migration
- Migrated from Google Sheets to Firestore
- Load times: 20-30s → <200ms
- Added offline mode (50MB cache)
- Real-time sync enabled

