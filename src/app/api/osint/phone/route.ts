import { NextResponse } from 'next/server';

const COUNTRY_DATA: Record<string, { name: string, lat: number, lng: number }> = {
  '1': { name: 'United States / Canada', lat: 39.8283, lng: -98.5795 },
  '44': { name: 'United Kingdom', lat: 55.3781, lng: -3.4360 },
  '61': { name: 'Australia', lat: -25.2744, lng: 133.7751 },
  '81': { name: 'Japan', lat: 36.2048, lng: 138.2529 },
  '86': { name: 'China', lat: 35.8617, lng: 104.1954 },
  '49': { name: 'Germany', lat: 51.1657, lng: 10.4515 },
  '33': { name: 'France', lat: 46.2276, lng: 2.2137 },
  '7': { name: 'Russia / Kazakhstan', lat: 61.5240, lng: 105.3188 },
  '55': { name: 'Brazil', lat: -14.2350, lng: -51.9253 },
  '91': { name: 'India', lat: 20.5937, lng: 78.9629 },
  '27': { name: 'South Africa', lat: -30.5595, lng: 22.9375 },
  '82': { name: 'South Korea', lat: 35.9078, lng: 127.7669 },
  '34': { name: 'Spain', lat: 40.4637, lng: -3.7492 },
  '39': { name: 'Italy', lat: 41.8719, lng: 12.5674 },
  '52': { name: 'Mexico', lat: 23.6345, lng: -102.5528 },
  '31': { name: 'Netherlands', lat: 52.1326, lng: 5.2913 },
  '46': { name: 'Sweden', lat: 60.1282, lng: 18.6435 },
  '41': { name: 'Switzerland', lat: 46.8182, lng: 8.2275 },
  '48': { name: 'Poland', lat: 51.9194, lng: 19.1451 },
  '43': { name: 'Austria', lat: 47.5162, lng: 14.5501 },
  '32': { name: 'Belgium', lat: 50.5039, lng: 4.4699 },
  '45': { name: 'Denmark', lat: 56.2639, lng: 9.5018 },
  '358': { name: 'Finland', lat: 61.9241, lng: 25.7482 },
  '47': { name: 'Norway', lat: 60.4720, lng: 8.4689 },
  '353': { name: 'Ireland', lat: 53.1424, lng: -7.6921 },
  '64': { name: 'New Zealand', lat: -40.9006, lng: 174.8860 },
  '65': { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
  '60': { name: 'Malaysia', lat: 4.2105, lng: 101.9758 },
  '62': { name: 'Indonesia', lat: -0.7893, lng: 113.9213 },
  '63': { name: 'Philippines', lat: 12.8797, lng: 121.7740 },
  '66': { name: 'Thailand', lat: 15.8700, lng: 100.9925 },
  '84': { name: 'Vietnam', lat: 14.0583, lng: 108.2772 },
  '92': { name: 'Pakistan', lat: 30.3753, lng: 69.3451 },
  '880': { name: 'Bangladesh', lat: 23.6850, lng: 90.3563 },
  '94': { name: 'Sri Lanka', lat: 7.8731, lng: 80.7718 },
  '98': { name: 'Iran', lat: 32.4279, lng: 53.6880 },
  '90': { name: 'Turkey', lat: 38.9637, lng: 35.2433 },
  '972': { name: 'Israel', lat: 31.0461, lng: 34.8516 },
  '966': { name: 'Saudi Arabia', lat: 23.8859, lng: 45.0792 },
  '971': { name: 'United Arab Emirates', lat: 23.4241, lng: 53.8478 },
  '20': { name: 'Egypt', lat: 26.8206, lng: 30.8025 },
  '234': { name: 'Nigeria', lat: 9.0820, lng: 8.6753 },
  '254': { name: 'Kenya', lat: -0.0236, lng: 37.9062 },
  '255': { name: 'Tanzania', lat: -6.3690, lng: 34.8888 },
  '256': { name: 'Uganda', lat: 1.3733, lng: 32.2903 },
  '212': { name: 'Morocco', lat: 31.7917, lng: -7.0926 },
  '213': { name: 'Algeria', lat: 28.0339, lng: 1.6596 },
  '216': { name: 'Tunisia', lat: 33.8869, lng: 9.5375 },
  '218': { name: 'Libya', lat: 26.3351, lng: 17.2283 },
  '221': { name: 'Senegal', lat: 14.4974, lng: -14.4524 },
  '225': { name: 'Ivory Coast', lat: 7.5400, lng: -5.5471 },
  '233': { name: 'Ghana', lat: 7.9465, lng: -1.0232 },
  '237': { name: 'Cameroon', lat: 7.3697, lng: 12.3547 },
  '244': { name: 'Angola', lat: -11.2027, lng: 17.8739 },
  '258': { name: 'Mozambique', lat: -18.6657, lng: 35.5296 },
  '260': { name: 'Zambia', lat: -13.1339, lng: 27.8493 },
  '263': { name: 'Zimbabwe', lat: -19.0154, lng: 29.1549 },
  '264': { name: 'Namibia', lat: -22.9576, lng: 18.4904 },
  '267': { name: 'Botswana', lat: -22.3285, lng: 24.6849 },
  '268': { name: 'Eswatini', lat: -26.5225, lng: 31.4659 },
  '54': { name: 'Argentina', lat: -38.4161, lng: -63.6167 },
  '56': { name: 'Chile', lat: -35.6751, lng: -71.5430 },
  '57': { name: 'Colombia', lat: 4.5709, lng: -74.2973 },
  '58': { name: 'Venezuela', lat: 6.4238, lng: -66.5897 },
  '51': { name: 'Peru', lat: -9.1900, lng: -75.0152 },
  '591': { name: 'Bolivia', lat: -16.2902, lng: -63.5887 },
  '593': { name: 'Ecuador', lat: -1.8312, lng: -78.1834 },
  '595': { name: 'Paraguay', lat: -23.4425, lng: -58.4438 },
  '598': { name: 'Uruguay', lat: -32.5228, lng: -55.7658 },
  '53': { name: 'Cuba', lat: 21.5218, lng: -77.7812 },
  '501': { name: 'Belize', lat: 17.1899, lng: -88.4976 },
  '502': { name: 'Guatemala', lat: 15.7835, lng: -90.2308 },
  '503': { name: 'El Salvador', lat: 13.7942, lng: -88.8965 },
  '504': { name: 'Honduras', lat: 15.2000, lng: -86.2419 },
  '505': { name: 'Nicaragua', lat: 12.8654, lng: -85.2072 },
  '506': { name: 'Costa Rica', lat: 9.7489, lng: -83.7534 },
  '507': { name: 'Panama', lat: 8.5380, lng: -80.7821 },
  '509': { name: 'Haiti', lat: 18.9712, lng: -72.2852 },
  '380': { name: 'Ukraine', lat: 48.3794, lng: 31.1656 },
  '375': { name: 'Belarus', lat: 53.7098, lng: 27.9534 },
  '370': { name: 'Lithuania', lat: 55.1694, lng: 23.8813 },
  '371': { name: 'Latvia', lat: 56.8796, lng: 24.6032 },
  '372': { name: 'Estonia', lat: 58.5953, lng: 25.0136 }
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const number = searchParams.get('number');

  if (!number) {
    return NextResponse.json({ error: 'Missing phone number parameter' }, { status: 400 });
  }

  // Pure JS parsing for zero-dependency robust execution
  let cleanNumber = number.replace(/[^\d+]/g, '');
  
  if (!cleanNumber.startsWith('+') && cleanNumber.length > 10) {
     cleanNumber = '+' + cleanNumber.replace(/^00/, '');
  } else if (!cleanNumber.startsWith('+') && cleanNumber.length === 10) {
     cleanNumber = '+1' + cleanNumber;
  }

  let cc = '';
  let national = cleanNumber.replace('+', '');
  
  if (cleanNumber.startsWith('+')) {
     const withoutPlus = cleanNumber.substring(1);
     for (let i = 4; i >= 1; i--) {
        const prefix = withoutPlus.substring(0, i);
        if (COUNTRY_DATA[prefix]) {
           cc = prefix;
           national = withoutPlus.substring(i);
           break;
        }
     }
  }

  const firstDigit = national.charAt(0);
  let lineType = 'LANDLINE';
  if (cc === '1' && national.length === 10) {
     lineType = 'MOBILE_OR_LANDLINE';
  } else if (firstDigit === '7' || firstDigit === '8' || firstDigit === '9') {
     lineType = 'MOBILE';
  }

  const data = cc && COUNTRY_DATA[cc] ? COUNTRY_DATA[cc] : null;
  const region = data ? data.name : 'Unknown Region';
  
  return NextResponse.json({
      query: number,
      valid: cleanNumber.length >= 7,
      number: cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`,
      international: cleanNumber.startsWith('+') ? `${cleanNumber.substring(0, cc.length+1)} ${national}` : cleanNumber,
      national: national,
      country_code: cc ? `+${cc}` : 'Unknown',
      region: region,
      line_type: lineType,
      lat: data?.lat || null,
      lng: data?.lng || null
  });
}
