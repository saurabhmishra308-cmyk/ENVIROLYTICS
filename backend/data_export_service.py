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
    """Service for importing data from Excel files."""
    
    @staticmethod
    def parse_excel(file_content: bytes) -> List[Dict]:
        """Parse Excel file and return list of dictionaries."""
        df = pd.read_excel(io.BytesIO(file_content))
        
        # Convert NaN to None
        df = df.where(pd.notnull(df), None)
        
        # Convert to list of dicts
        return df.to_dict('records')
    
    @staticmethod
    def validate_flowmeter_data(data: List[Dict]) -> tuple[List[Dict], List[str]]:
        """Validate imported flowmeter data."""
        valid_data = []
        errors = []
        
        required_fields = ['hardware_id', 'timestamp', 'flow_rate_lpm']
        
        for idx, row in enumerate(data, start=2):  # Excel rows start at 2
            # Check required fields
            missing_fields = [field for field in required_fields if field not in row or row[field] is None]
            if missing_fields:
                errors.append(f"Row {idx}: Missing fields {missing_fields}")
                continue
            
            # Validate timestamp
            try:
                if isinstance(row['timestamp'], str):
                    row['timestamp'] = pd.to_datetime(row['timestamp'])
            except Exception as e:
                errors.append(f"Row {idx}: Invalid timestamp - {e}")
                continue
            
            # Validate numeric fields
            try:
                row['flow_rate_lpm'] = float(row['flow_rate_lpm'])
                if 'forward_totalizer' in row and row['forward_totalizer'] is not None:
                    row['forward_totalizer'] = float(row['forward_totalizer'])
                if 'temperature' in row and row['temperature'] is not None:
                    row['temperature'] = float(row['temperature'])
            except Exception as e:
                errors.append(f"Row {idx}: Invalid numeric value - {e}")
                continue
            
            valid_data.append(row)
        
        return valid_data, errors
