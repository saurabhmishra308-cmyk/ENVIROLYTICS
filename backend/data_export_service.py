import pandas as pd
import io
from datetime import datetime
from typing import List, Dict, Optional
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT

class DataExportService:
    """Service for exporting data to CSV and PDF formats."""
    
    @staticmethod
    def to_csv(data: List[Dict], filename: str = "export.csv") -> bytes:
        """Convert data to CSV format."""
        df = pd.DataFrame(data)
        
        # Format datetime columns
        for col in df.columns:
            if 'timestamp' in col.lower() or 'date' in col.lower():
                df[col] = pd.to_datetime(df[col], format='mixed', errors='coerce', utc=True).dt.strftime('%Y-%m-%d %H:%M:%S')
        
        # Convert to CSV bytes
        csv_buffer = io.StringIO()
        df.to_csv(csv_buffer, index=False)
        return csv_buffer.getvalue().encode('utf-8')
    
    @staticmethod
    def to_pdf(data: List[Dict], title: str, filename: str = "export.pdf") -> bytes:
        """Convert data to PDF format with table."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        elements = []
        styles = getSampleStyleSheet()
        
        # Title
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=16,
            textColor=colors.HexColor('#1a2332'),
            spaceAfter=20,
            alignment=TA_CENTER
        )
        elements.append(Paragraph(title, title_style))
        elements.append(Spacer(1, 0.3*inch))
        
        # Company header
        header_style = ParagraphStyle(
            'Header',
            parent=styles['Normal'],
            fontSize=10,
            textColor=colors.HexColor('#4a9fd8'),
            spaceAfter=10,
            alignment=TA_CENTER
        )
        elements.append(Paragraph("Envirolytics Sustainability Private Limited", header_style))
        elements.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", header_style))
        elements.append(Spacer(1, 0.3*inch))
        
        if data:
            df = pd.DataFrame(data)
            
            # Format data
            for col in df.columns:
                if 'timestamp' in col.lower() or 'date' in col.lower():
                    df[col] = pd.to_datetime(df[col], format='mixed', errors='coerce', utc=True).dt.strftime('%Y-%m-%d %H:%M')
                elif df[col].dtype in ['float64', 'float32']:
                    df[col] = df[col].round(2)
            
            # Prepare table data
            table_data = [df.columns.tolist()] + df.values.tolist()
            
            # Create table
            table = Table(table_data, repeatRows=1)
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4a9fd8')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 10),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
                ('GRID', (0, 0), (-1, -1), 1, colors.black),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.lightgrey]),
            ]))
            elements.append(table)
        else:
            elements.append(Paragraph("No data available", styles['Normal']))
        
        doc.build(elements)
        return buffer.getvalue()

class ExcelImportService:
    """Service for importing data from Excel/CSV files."""

    @staticmethod
    def parse_file(file_content: bytes, filename: str) -> List[Dict]:
        """Parse Excel (.xlsx/.xls) or CSV (.csv) file → list of dicts.

        CSV files are parsed with `pandas.read_csv`; Excel via `pandas.read_excel`.
        The `filename` extension decides which parser is used.
        """
        name = (filename or "").lower()
        buf = io.BytesIO(file_content)
        if name.endswith(".csv"):
            df = pd.read_csv(buf)
        elif name.endswith((".xlsx", ".xls")):
            df = pd.read_excel(buf)
        else:
            raise ValueError("Unsupported file type. Use .csv, .xlsx or .xls")
        df = df.where(pd.notnull(df), None)
        # Strip whitespace from column names to be forgiving
        df.columns = [str(c).strip() for c in df.columns]
        return df.to_dict("records")

    @staticmethod
    def parse_excel(file_content: bytes) -> List[Dict]:
        """Parse Excel file and return list of dictionaries. (Legacy signature — CSV
        callers should use parse_file which sniffs the extension.)"""
        df = pd.read_excel(io.BytesIO(file_content))

        # Convert NaN to None
        df = df.where(pd.notnull(df), None)

        # Convert to list of dicts
        return df.to_dict('records')

    @staticmethod
    def _normalize_ts(v):
        if v is None or v == "":
            return None
        try:
            ts = pd.to_datetime(v, errors="coerce", utc=True)
            if pd.isna(ts):
                return None
            return ts.isoformat()
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def validate_flowmeter_data(data: List[Dict]) -> tuple[List[Dict], List[str]]:
        """Validate imported flowmeter rows.

        Required columns: hardware_id, timestamp, and ONE of
          - flow_rate_m3h   (canonical unit — preferred)
          - flow_rate_lpm   (legacy — L/M)
          - flow_rate_lph   (legacy — L/H)
        Optional columns: the other two flow columns, tot1..2, rtot1..2,
            forward_totalizer, reverse_totalizer, temperature, unit_name,
            unit_code, signal_strength, imei, imsi, firmware_version.
        Missing optional numerics default to 0. Whatever flow unit the CSV
        supplies is coerced into all three canonical fields at write time.
        """
        valid_data = []
        errors = []
        flow_cols = ("flow_rate_m3h", "flow_rate_lpm", "flow_rate_lph")

        for idx, row in enumerate(data, start=2):  # spreadsheet rows start at 2 (header = row 1)
            for base in ("hardware_id", "timestamp"):
                if row.get(base) in (None, ""):
                    errors.append(f"Row {idx}: missing required column '{base}'")
                    row["_bad"] = True
                    break
            if row.get("_bad"):
                continue
            if not any(row.get(c) not in (None, "") for c in flow_cols):
                errors.append(f"Row {idx}: must supply one of {flow_cols}")
                continue
            ts = ExcelImportService._normalize_ts(row.get("timestamp"))
            if not ts:
                errors.append(f"Row {idx}: invalid timestamp '{row.get('timestamp')}'")
                continue
            row["timestamp"] = ts
            try:
                # Parse whichever flow columns are present
                for c in flow_cols:
                    if row.get(c) not in (None, ""):
                        row[c] = float(row[c])
                # Derive the two missing flow columns from the one that was
                # supplied. m³/h is the source of truth.
                if row.get("flow_rate_m3h") is not None:
                    m3h = float(row["flow_rate_m3h"])
                elif row.get("flow_rate_lph") is not None:
                    m3h = float(row["flow_rate_lph"]) / 1000.0
                else:
                    m3h = float(row["flow_rate_lpm"]) * 0.06  # L/M → m³/h
                row["flow_rate_m3h"] = round(m3h, 4)
                row["flow_rate_lph"] = round(m3h * 1000.0, 4)
                row["flow_rate_lpm"] = round(row["flow_rate_lph"] / 60.0, 4)
                # Fill optional numerics with 0 if missing
                for col in ("tot1", "tot2", "rtot1", "rtot2", "forward_totalizer",
                            "reverse_totalizer", "temperature", "signal_strength"):
                    if row.get(col) not in (None, ""):
                        row[col] = float(row[col])
                    else:
                        row[col] = 0.0 if col != "signal_strength" else 0
            except (ValueError, TypeError) as e:
                errors.append(f"Row {idx}: invalid numeric value — {e}")
                continue
            row.setdefault("unit_code", 6)      # M3/H
            row.setdefault("unit_name", "m3/h")
            row["canonical_unit"] = "m3/h"
            row["hardware_id"] = str(row["hardware_id"]).strip()
            valid_data.append(row)
        return valid_data, errors

    @staticmethod
    def validate_dwlr_data(data: List[Dict]) -> tuple[List[Dict], List[str]]:
        """Validate imported DWLR rows.

        Required columns: hardware_id, timestamp, level_mwc.
        Optional: signal (dBm), imei.
        """
        valid_data: List[Dict] = []
        errors: List[str] = []
        for idx, row in enumerate(data, start=2):
            missing = [f for f in ("hardware_id", "timestamp", "level_mwc")
                       if row.get(f) in (None, "")]
            if missing:
                errors.append(f"Row {idx}: missing required column(s) {missing}")
                continue
            ts = ExcelImportService._normalize_ts(row.get("timestamp"))
            if not ts:
                errors.append(f"Row {idx}: invalid timestamp '{row.get('timestamp')}'")
                continue
            try:
                level = float(row["level_mwc"])
            except (ValueError, TypeError):
                errors.append(f"Row {idx}: level_mwc must be numeric (mWC)")
                continue
            values = {"LEVEL": level}
            if row.get("signal") not in (None, ""):
                try:
                    values["SIGNAL"] = int(float(row["signal"]))
                except (ValueError, TypeError):
                    pass
            imei = str(row.get("imei") or "").strip() or None
            valid_data.append({
                "hardware_id": str(row["hardware_id"]).strip(),
                "instrument_type": "dwlr",
                "timestamp": ts,
                "values": values,
                "imei": imei,
            })
        return valid_data, errors

    # --- CSV template builders ---------------------------------------
    @staticmethod
    def flowmeter_template_csv() -> bytes:
        """Sample CSV template with one example row for the admin to fill."""
        cols = [
            "hardware_id", "timestamp",
            # Canonical unit — the ONE column you must fill. The other
            # two flow columns are optional; when omitted we compute
            # them from m³/h automatically.
            "flow_rate_m3h",
            "flow_rate_lpm", "flow_rate_lph",
            "tot1", "tot2", "rtot1", "rtot2", "forward_totalizer",
            "reverse_totalizer", "temperature", "signal_strength",
            "unit_code", "unit_name", "imei", "imsi", "firmware_version",
        ]
        sample = [
            "FM_PLANT_A_01", "2026-07-01 09:00:00",
            "2.4582",           # m³/h — canonical
            "40.97", "2458.2",  # legacy L/M + L/H (derived)
            "40.97", "0", "0", "0", "40.97",
            "0", "22.5", "13",
            "6", "m3/h", "860738070478155", "404980524791050", "4G-1",
        ]
        buf = io.StringIO()
        w = pd.DataFrame([dict(zip(cols, sample))], columns=cols)
        w.to_csv(buf, index=False)
        return buf.getvalue().encode("utf-8")

    @staticmethod
    def dwlr_template_csv() -> bytes:
        cols = ["hardware_id", "timestamp", "level_mwc", "signal", "imei"]
        sample = ["DWLR_BOREWELL_01", "2026-07-01 09:00:00", "12.45", "13", "860738070478155"]
        buf = io.StringIO()
        w = pd.DataFrame([dict(zip(cols, sample))], columns=cols)
        w.to_csv(buf, index=False)
        return buf.getvalue().encode("utf-8")
