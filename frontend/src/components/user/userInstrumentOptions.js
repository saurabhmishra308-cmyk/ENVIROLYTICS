// Shared constants for the create-user instrument wizard.

export const INSTRUMENT_TYPE_OPTIONS = [
  { value: 'flowmeter',         label: 'Flowmeter' },
  { value: 'dwlr',              label: 'DWLR (Water Level)' },
  { value: 'do_meter',          label: 'DO Analyzer (Aeration Tanks)' },
  { value: 'wq_stp',            label: 'OCEMS / Water Quality Analyzer' },
  { value: 'chlorine_analyzer', label: 'Chlorine Analyzer (STP Effluent)' },
  { value: 'ph',                label: 'pH Sensor' },
  { value: 'tds',               label: 'TDS Sensor' },
  { value: 'conductivity',      label: 'Conductivity Sensor' },
];

// Default telemetry source per type. DO / OCEMS are typically HTTP-polled via
// QESPL; every other type defaults to MQTT.
export const DEFAULT_SOURCE = { do_meter: 'http', wq_stp: 'http' };

export const FLOWMETER_CATEGORY_OPTIONS = [
  { value: 'groundwater_abstraction', label: 'Groundwater Abstraction' },
  { value: 'stp_inlet', label: 'STP Inlet' },
  { value: 'stp_outlet', label: 'STP Outlet' },
];

export const EMPTY_INSTRUMENT_ROW = {
  hardware_id: '',
  instrument_type: 'flowmeter',
  label: '',
  category: 'groundwater_abstraction',
  location_name: '',
  latitude: '',
  longitude: '',
  imei: '',
  manual_water_temp_c: '',
  source: 'mqtt',
  aeration_tank_number: '',
  plant_capacity_kld: '',
  tank_capacity_kld: '',
};
