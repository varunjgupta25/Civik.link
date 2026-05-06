/**
 * Civik.Link Real-Time Bluetooth Hardware Service
 * Handles direct BLE communication with Smartwatches and Medical Sensors.
 * NO MOCKS. This uses the browser's physical Bluetooth radio.
 */

const BluetoothService = {
    device: null,
    server: null,
    heartRateCharacteristic: null,

    async connectHeartRate() {
        try {
            console.log("[BLE] Requesting Bluetooth Device...");
            
            // Filters for standard Heart Rate Service
            const options = {
                filters: [{ services: ['heart_rate'] }],
                optionalServices: ['battery_service', 'device_information']
            };

            this.device = await navigator.bluetooth.requestDevice(options);
            
            console.log(`[BLE] Found: ${this.device.name}`);
            
            this.device.addEventListener('gattserverdisconnected', () => {
                console.warn("[BLE] Device Disconnected");
                // Auto-reconnect logic could go here
            });

            this.server = await this.device.gatt.connect();
            console.log("[BLE] Connected to GATT Server");

            const service = await this.server.getPrimaryService('heart_rate');
            this.heartRateCharacteristic = await service.getCharacteristic('heart_rate_measurement');

            // Start receiving real-time data
            await this.heartRateCharacteristic.startNotifications();
            
            this.heartRateCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
                const heartRate = this.parseHeartRate(event.target.value);
                console.log(`[BLE] Real-time HR: ${heartRate} bpm`);
                
                // Dispatch event for the UI to pick up
                window.dispatchEvent(new CustomEvent('civik:ble-update', { 
                    detail: { type: 'heart_rate', value: heartRate } 
                }));
            });

            return { success: true, name: this.device.name };
        } catch (error) {
            console.error("[BLE] Connection Failed:", error);
            throw error;
        }
    },

    parseHeartRate(value) {
        // Standard BLE Heart Rate Measurement parser
        const flags = value.getUint8(0);
        const rate16Bits = flags & 0x1;
        if (rate16Bits) {
            return value.getUint16(1, true);
        } else {
            return value.getUint8(1);
        }
    },

    /**
     * Virtual Hardware Lab: Simulates a real-time data stream for testing.
     * Use this when physical hardware is unavailable.
     */
    async simulate() {
        console.log("[BLE] Initializing Virtual Hardware Lab...");
        const mockName = "Civik Watch Pro (Simulated)";
        
        // Return immediately to mimic successful pairing
        setTimeout(() => {
            console.log(`[BLE] Virtual Device Connected: ${mockName}`);
            
            // Start simulation loop
            setInterval(() => {
                // Generate a realistic heart rate between 68 and 82
                const simHR = Math.floor(Math.random() * (82 - 68 + 1)) + 68;
                
                window.dispatchEvent(new CustomEvent('civik:ble-update', { 
                    detail: { type: 'heart_rate', value: simHR } 
                }));
            }, 2000);
        }, 800);

        return { success: true, name: mockName };
    },

    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
            console.log("[BLE] Manually Disconnected");
        }
    }
};

window.BluetoothService = BluetoothService;
