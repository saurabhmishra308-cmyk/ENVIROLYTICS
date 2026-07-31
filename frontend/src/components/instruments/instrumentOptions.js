// Shared instrument form constants — used by Instruments page + dialogs.
export const TYPE_OPTIONS = [
  { value: 'flowmeter', label: 'Flowmeter' },
  { value: 'dwlr', label: 'DWLR (Water Level)' },
  { value: 'ph', label: 'pH Sensor' },
  { value: 'tds', label: 'TDS Sensor' },
  { value: 'conductivity', label: 'Conductivity Sensor' },
  { value: 'wq_stp', label: 'OCEMS (Online Continuous Effluent Monitoring System)' },
  { value: 'do_meter', label: 'DO Analyzer (Aeration Tanks)' },
  { value: 'chlorine_analyzer', label: 'Chlorine Analyzer (STP Effluent)' },
];

// Category picker options for `flowmeter` — every other type has a *fixed*
// category derived from `INSTRUMENT_CATEGORY_MAP` below (see form auto-fill).
export const CATEGORY_OPTIONS = [
  { value: 'groundwater_abstraction', label: 'Groundwater Abstraction' },
  { value: 'stp_inlet', label: 'STP Inlet' },
  { value: 'stp_outlet', label: 'STP Outlet' },
];

// Fixed category per non-flowmeter instrument type. Displayed read-only in the
// form; sent to the backend on save so downstream reports can group devices.
export const INSTRUMENT_CATEGORY_MAP = {
  dwlr:              { value: 'groundwater_level',   label: 'Ground Water Level Monitoring' },
  ph:                { value: 'groundwater_quality', label: 'Ground Water Quality' },
  tds:               { value: 'groundwater_quality', label: 'Ground Water Quality' },
  conductivity:      { value: 'groundwater_quality', label: 'Ground Water Quality' },
  wq_stp:            { value: 'stp_water_quality',   label: 'STP Water Quality' },
  do_meter:          { value: 'stp_water_quality',   label: 'STP Water Quality' },
  chlorine_analyzer: { value: 'stp_water_quality',   label: 'STP Water Quality' },
};

export const EMPTY_FORM = {
  hardware_id: '',
  instrument_type: 'flowmeter',
  owner_user_id: '',
  label: '',
  location_name: '',
  latitude: '',
  longitude: '',
  category: 'groundwater_abstraction',
  imei: '',
  manual_water_temp_c: '',
  plant_capacity_kld: '',
  tank_capacity_kld: '',
};
