# Tallyfy Backend

A backend API service for the Tallyfy application.

## Local Development

1. Clone the repository:
```
git clone https://github.com/jaysomani/Tallyfy.backend.git
```

2. Install dependencies:
```
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
DB_HOST=tallyfyai.clgu2myyama2.ap-south-1.rds.amazonaws.com
DB_PORT=5432
DB_USER=tallyfyai
DB_PASSWORD=Tallyfy123
DB_NAME=postgres
PORT=3001
```

4. Start the development server:
```
npm run dev
```

## EC2 Deployment Instructions

### 1. Launch an EC2 Instance

1. Log in to the AWS Management Console
2. Navigate to EC2 Dashboard
3. Click "Launch Instance"
4. Choose an Amazon Linux 2 AMI or Ubuntu Server
5. Select an instance type (t2.micro is sufficient for testing)
6. Configure security groups to allow:
   - SSH (Port 22) from your IP
   - HTTP (Port 80) from anywhere
   - HTTPS (Port 443) from anywhere
   - Custom TCP (Port 3001) from anywhere
7. Launch the instance and download the key pair

### 2. Connect to Your EC2 Instance

```
ssh -i /path/to/your-key.pem ec2-user@your-ec2-ip
```

Or for Ubuntu:
```
ssh -i /path/to/your-key.pem ubuntu@your-ec2-ip
```

### 3. Install Required Software

For Amazon Linux:
```
sudo yum update -y
sudo yum install git -y

# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 16
```

For Ubuntu:
```
sudo apt update
sudo apt install git -y

# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 16
```

### 4. Clone and Set Up the Application

```
git clone https://github.com/jaysomani/Tallyfy.backend.git
cd Tallyfy.backend
npm install
```

### 5. Create the .env File

```
cat > .env << 'EOL'
DB_HOST=tallyfyai.clgu2myyama2.ap-south-1.rds.amazonaws.com
DB_PORT=5432
DB_USER=tallyfyai
DB_PASSWORD=Tallyfy123
DB_NAME=postgres
PORT=3001
EOL
```

### 6. Install PM2 for Process Management

```
npm install pm2 -g
```

### 7. Start the Application with PM2

```
pm2 start index.js --name tallyfy-backend
```

### 8. Set Up PM2 to Start on System Boot

```
pm2 startup
```
(Follow the instructions in the output)

```
pm2 save
```

### 9. (Optional) Set Up Nginx as a Reverse Proxy

Install Nginx:

Amazon Linux:
```
sudo amazon-linux-extras install nginx1 -y
```

Ubuntu:
```
sudo apt install nginx -y
```

Configure Nginx:

```
sudo nano /etc/nginx/conf.d/tallyfy.conf
```

Add:
```
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Test and restart Nginx:
```
sudo nginx -t
sudo systemctl restart nginx
```

### 10. Update Application on EC2

To update your application:

```
cd ~/Tallyfy.backend
git pull
npm install
pm2 restart tallyfy-backend
```

## Setting Up HTTPS with Let's Encrypt (Optional)

If you have a domain pointing to your EC2 instance:

```
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Follow the prompts to complete the certificate installation.

Certificate will auto-renew via a cron job that Certbot sets up. 