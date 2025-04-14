// utils/helpers.js
const emailToSafeString = (email) => {
    return email.toLowerCase().replace(/[@.]/g, '_');
  };
  
  const convertDate = (dateStr) => {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return dateStr; // if unexpected format
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  };
  
  const formatCompanyName = (companyName) => {
    return companyName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };
  
  module.exports = { emailToSafeString, convertDate, formatCompanyName };
  